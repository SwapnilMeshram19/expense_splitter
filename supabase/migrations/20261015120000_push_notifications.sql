-- Push notifications (pre-release step 7b): tell members about changes other people made.
--
--   phone (FCM token) ── public.register_push_device ──▶ public.push_devices
--   activity_log insert ── trigger ──▶ private.push_outbox          (only if someone could be told)
--   pg_cron, every minute, only while the outbox has rows ──▶ Edge Function push-send
--   push-send ── public.claim_push_notifications ──▶ what to send, per device and group
--             ── FCM HTTP v1 ──▶ phones;  dead tokens ── public.drop_push_devices
--
-- What is sent:
--   * an expense someone else added (or a repeating one the server/phone created), to members
--     who have a share in it or paid for it;
--   * a payment someone else recorded, to the payer and the receiver;
--   * a group budget crossing 80% and 100% (once per level, per month for monthly budgets), to
--     every member.
-- Batched per run: a phone that pushes 12 offline expenses gives one "12 new expenses" message.
-- Edits and deletes aren't notified (noise); they show in the app's activity as before.
--
-- Privacy: messages go through Google (FCM). They carry the group name, who, the description
-- and amounts; never notes, receipts or UPI IDs. Tokens are tied to the account, deleted on
-- sign-out, and dropped as soon as FCM says they're dead.

-- ── 1. Devices ─────────────────────────────────────────────────────────

create table public.push_devices (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'android',
  notify_expenses boolean not null default true,
  notify_payments boolean not null default true,
  notify_budget boolean not null default true,
  -- Format rupees as ₹1,23,456 (Indian phones) or ₹123,456, like the app on that phone.
  indian_grouping boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_devices_token_check check (char_length(token) between 20 and 4096 and token !~ '\s'),
  constraint push_devices_platform_check check (platform in ('android', 'ios'))
);

create index push_devices_user_idx on public.push_devices (user_id);

-- No policies: only the functions below touch it.
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant select, insert, update, delete on public.push_devices to service_role;

/** Save this phone's token and choices for the signed-in user. A token moves with the account. */
create function public.register_push_device(
  p_token text,
  p_platform text,
  p_expenses boolean,
  p_payments boolean,
  p_budget boolean,
  p_indian_grouping boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  insert into public.push_devices as d
    (token, user_id, platform, notify_expenses, notify_payments, notify_budget, indian_grouping)
  values
    (p_token, v_user, coalesce(p_platform, 'android'), coalesce(p_expenses, true),
     coalesce(p_payments, true), coalesce(p_budget, true), coalesce(p_indian_grouping, true))
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        notify_expenses = excluded.notify_expenses,
        notify_payments = excluded.notify_payments,
        notify_budget = excluded.notify_budget,
        indian_grouping = excluded.indian_grouping,
        updated_at = now();

  -- At most 10 phones per account: the least recently registered go first.
  delete from public.push_devices d
  where d.user_id = v_user
    and d.token in (
      select token from public.push_devices
      where user_id = v_user
      order by updated_at desc
      offset 10
    );
end;
$$;

/** Forget this phone (sign-out, or every notification type turned off). */
create function public.unregister_push_device(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_devices where token = p_token and user_id = (select auth.uid());
$$;

revoke execute on function public.register_push_device(text, text, boolean, boolean, boolean, boolean) from public, anon;
revoke execute on function public.unregister_push_device(text) from public, anon;
grant execute on function public.register_push_device(text, text, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;

-- ── 2. Outbox ──────────────────────────────────────────────────────────

create table private.push_outbox (
  id bigint generated always as identity primary key,
  activity_id uuid not null unique,
  created_at timestamptz not null default now()
);

create table private.push_budget_alerts (
  group_id uuid not null references public.groups (id) on delete cascade,
  -- 'total:<limit>' or 'YYYY-MM:<limit>': a new limit starts over.
  period_key text not null,
  level smallint not null, -- 1 = 80% reached, 2 = over
  sent_at timestamptz not null default now(),
  primary key (group_id, period_key)
);

create function private.enqueue_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only when at least one member of the group has a phone registered: groups where nobody
  -- uses push never fill the outbox (and never wake the sender).
  if exists (
    select 1
    from public.members m
    join public.push_devices d on d.user_id = m.user_id
    where m.group_id = new.group_id and m.deleted_at is null
  ) then
    insert into private.push_outbox (activity_id) values (new.id) on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function private.enqueue_push() from public, anon, authenticated;

create trigger activity_push
after insert on public.activity_log
for each row
when (new.action = 'create' and new.entity_type in ('expense', 'settlement'))
execute function private.enqueue_push();

-- ── 3. Claim: what to send ─────────────────────────────────────────────

/**
 * Takes up to p_limit outbox entries (deleting them: notifications are best effort, never
 * retried) and returns one entry per (device, group, kind):
 *   [{ token, indian_grouping, kind: 'activity'|'budget', group_id, group_name, currency,
 *      events: [...] }]
 * activity events: { type: 'expense', expense_id, description, amount, share, paid, actor, recurring }
 *                  { type: 'payment', settlement_id, amount, from_name, to_name, role: 'from'|'to', actor }
 * budget events:   { type: 'budget', level: 1|2, limit, spent, period: 'total'|'YYYY-MM' }
 * Entries older than an hour (sender down) are dropped rather than sent late.
 */
create function public.claim_push_notifications(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_result jsonb;
begin
  with taken as (
    delete from private.push_outbox o
    where o.id in (
      select id from private.push_outbox order by id limit greatest(1, least(p_limit, 2000))
      for update skip locked
    )
    returning o.activity_id, o.created_at
  )
  select coalesce(array_agg(activity_id), '{}') into v_ids
  from taken
  where created_at > now() - interval '1 hour';

  if cardinality(v_ids) = 0 then
    return '[]'::jsonb;
  end if;

  create temporary table if not exists pg_temp.push_events (
    user_id uuid not null,
    group_id uuid not null,
    kind text not null,      -- 'expense' | 'payment' | 'budget' (device preference)
    event jsonb not null,
    created_at bigint not null
  ) on commit drop;
  truncate pg_temp.push_events;

  -- Expenses: everyone with a share or who paid, except whoever added it.
  insert into pg_temp.push_events (user_id, group_id, kind, event, created_at)
  select m.user_id, a.group_id, 'expense',
         jsonb_build_object(
           'type', 'expense',
           'expense_id', e.id,
           'description', e.description,
           'amount', e.amount_paise,
           'share', coalesce(s.amount_paise, 0),
           'paid', coalesce(p.amount_paise, 0),
           'actor', am.display_name,
           'recurring', e.recurring_rule_id is not null),
         a.created_at
  from public.activity_log a
  join public.expenses e on e.id = a.entity_id and e.group_id = a.group_id and e.deleted_at is null
  join public.members m on m.group_id = a.group_id and m.user_id is not null and m.deleted_at is null
  left join public.members am on am.id = a.actor_member_id
  left join public.expense_shares s on s.expense_id = e.id and s.member_id = m.id
  left join public.expense_payers p on p.expense_id = e.id and p.member_id = m.id
  where a.id = any (v_ids)
    and a.entity_type = 'expense'
    and (coalesce(s.amount_paise, 0) > 0 or coalesce(p.amount_paise, 0) > 0)
    and m.user_id is distinct from am.user_id;

  -- Payments: the payer and the receiver, except whoever recorded it.
  insert into pg_temp.push_events (user_id, group_id, kind, event, created_at)
  select m.user_id, a.group_id, 'payment',
         jsonb_build_object(
           'type', 'payment',
           'settlement_id', st.id,
           'amount', st.amount_paise,
           'from_name', fm.display_name,
           'to_name', tm.display_name,
           'role', case when m.id = st.to_member_id then 'to' else 'from' end,
           'actor', am.display_name),
         a.created_at
  from public.activity_log a
  join public.settlements st on st.id = a.entity_id and st.group_id = a.group_id and st.deleted_at is null
  join public.members fm on fm.id = st.from_member_id
  join public.members tm on tm.id = st.to_member_id
  join public.members m on m.id in (st.from_member_id, st.to_member_id)
                       and m.user_id is not null and m.deleted_at is null
  left join public.members am on am.id = a.actor_member_id
  where a.id = any (v_ids)
    and a.entity_type = 'settlement'
    and m.user_id is distinct from am.user_id;

  -- Budgets: groups (and months) that got new expenses in this batch.
  with touched as (
    select distinct g.id as group_id, g.budget_paise as lim, g.budget_period as period,
           case when g.budget_period = 'monthly' then to_char(e.expense_date, 'YYYY-MM') else 'total' end as period_name
    from public.activity_log a
    join public.expenses e on e.id = a.entity_id and e.deleted_at is null
    join public.groups g on g.id = a.group_id and g.deleted_at is null
    where a.id = any (v_ids) and a.entity_type = 'expense'
      and g.budget_paise is not null and g.budget_period is not null
  ),
  status as (
    select t.*,
           (select coalesce(sum(x.amount_paise), 0) from public.expenses x
            where x.group_id = t.group_id and x.deleted_at is null
              and (t.period = 'total' or to_char(x.expense_date, 'YYYY-MM') = t.period_name)) as spent
    from touched t
  ),
  levels as (
    select s.*, s.period_name || ':' || s.lim as period_key,
           case when s.spent > s.lim then 2 when s.spent * 5 >= s.lim * 4 then 1 else 0 end as level
    from status s
  ),
  fresh as (
    insert into private.push_budget_alerts as b (group_id, period_key, level)
    select l.group_id, l.period_key, l.level from levels l where l.level > 0
    on conflict (group_id, period_key) do update
      set level = excluded.level, sent_at = now()
      where b.level < excluded.level
    returning b.group_id, b.period_key, b.level
  )
  insert into pg_temp.push_events (user_id, group_id, kind, event, created_at)
  select m.user_id, l.group_id, 'budget',
         jsonb_build_object('type', 'budget', 'level', l.level, 'limit', l.lim, 'spent', l.spent,
                            'period', l.period_name),
         0
  from fresh f
  join levels l on l.group_id = f.group_id and l.period_key = f.period_key
  join public.members m on m.group_id = l.group_id and m.user_id is not null and m.deleted_at is null;

  select coalesce(jsonb_agg(n order by n->>'group_id', n->>'kind', n->>'token'), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
             'token', d.token,
             'indian_grouping', d.indian_grouping,
             'kind', case when ev.kind = 'budget' then 'budget' else 'activity' end,
             'group_id', g.id,
             'group_name', g.name,
             'currency', g.currency,
             'events', jsonb_agg(ev.event order by ev.created_at, ev.event->>'expense_id', ev.event->>'settlement_id')
           ) as n
    from pg_temp.push_events ev
    join public.groups g on g.id = ev.group_id and g.deleted_at is null
    join public.push_devices d on d.user_id = ev.user_id
    where (ev.kind = 'expense' and d.notify_expenses)
       or (ev.kind = 'payment' and d.notify_payments)
       or (ev.kind = 'budget' and d.notify_budget)
    group by d.token, d.indian_grouping, g.id, g.name, g.currency,
             case when ev.kind = 'budget' then 'budget' else 'activity' end
  ) q;

  return v_result;
end;
$$;

/** Tokens FCM reported as unregistered / invalid. */
create function public.drop_push_devices(p_tokens text[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (delete from public.push_devices where token = any (p_tokens) returning 1)
  select count(*)::integer from gone;
$$;

/** FCM service-account JSON, from Vault (fcm_service_account). Null until it's set. */
create function public.push_fcm_credentials()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'fcm_service_account' limit 1;
$$;

revoke execute on function public.claim_push_notifications(integer) from public, anon, authenticated;
revoke execute on function public.drop_push_devices(text[]) from public, anon, authenticated;
revoke execute on function public.push_fcm_credentials() from public, anon, authenticated;
grant execute on function public.claim_push_notifications(integer) to service_role;
grant execute on function public.drop_push_devices(text[]) to service_role;
grant execute on function public.push_fcm_credentials() to service_role;

-- ── 4. Schedule ────────────────────────────────────────────────────────
-- Every minute, but the HTTP call happens only while the outbox has rows: an idle app costs
-- nothing beyond a one-row check. Uses the same Vault secret as fx-refresh (fx_cron_secret) and
-- one more Vault entry with the function's URL:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/push-send', 'push_send_url');
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('push-send', '* * * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'push_send_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fx_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000)
      where exists (select 1 from private.push_outbox)
        and exists (select 1 from vault.decrypted_secrets where name = 'push_send_url')
    $job$);
  end if;
end;
$outer$;

notify pgrst, 'reload schema';
