-- Recurring expenses (pre-release step 3).
--
-- * public.recurring_rules: synced like expenses (version, change_xid, conflicts). The template is
--   stored fully computed (payers + shares, group currency), checked by the Edge Function with
--   src/domain, so creating an occurrence is a plain copy: no split maths in SQL.
-- * An occurrence is an ordinary expense with recurring_rule_id + occurrence_date, and its id is
--   uuid_generate_v5('5c1e9a52-4b7d-4f2e-9d0a-3c8b6e2f1a47', '<rule id>/<YYYY-MM-DD>'), exactly what src/domain/recurrence.ts
--   computes. A phone that's offline on the 1st creates the same row the server job creates;
--   when both do, the second push is a version conflict that the app resolves on its own.
-- * private.generate_recurring_occurrences(): hourly pg_cron job. "Today" is the rule's own time
--   zone (the creating phone's), so rent dated the 1st appears just after midnight there.
-- * Builds from before this migration don't know rules; they simply see the generated expenses.

create extension if not exists "uuid-ossp" with schema extensions;
-- The occurrence CHECK below runs as whoever writes expenses (service_role in apply_push). This
-- project revokes EXECUTE from PUBLIC on new functions, so grant it where the extension is new.
grant usage on schema extensions to service_role;
grant execute on function extensions.uuid_generate_v5(uuid, text) to service_role;

-- ── 1. Occurrence columns on expenses ──────────────────────────────────

alter table public.expenses
  add column recurring_rule_id uuid,
  add column occurrence_date date;

alter table public.expenses add constraint expenses_occurrence_check check (
  (recurring_rule_id is null and occurrence_date is null)
  or (
    recurring_rule_id is not null and occurrence_date is not null
    -- The id is derived from the rule and the date, so duplicates collide instead of doubling up.
    and id = extensions.uuid_generate_v5(
      '5c1e9a52-4b7d-4f2e-9d0a-3c8b6e2f1a47'::uuid, recurring_rule_id::text || '/' || to_char(occurrence_date, 'YYYY-MM-DD'))
  )
);

create index expenses_recurring_rule_idx on public.expenses (recurring_rule_id)
  where recurring_rule_id is not null;

create function private.apply_expense_recurring()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := nullif(current_setting('app.push_expense_recurring', true), '')::jsonb;
  v_row jsonb;
begin
  if v_map is null then
    return new; -- not a push (e.g. the generator): columns as written
  end if;
  v_row := v_map -> new.id::text;
  if v_row is not null then
    new.recurring_rule_id := (v_row ->> 'r')::uuid;
    new.occurrence_date := (v_row ->> 'd')::date;
  elsif tg_op = 'UPDATE' then
    -- Builds that don't send the keys keep the link.
    new.recurring_rule_id := old.recurring_rule_id;
    new.occurrence_date := old.occurrence_date;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_expense_recurring() from public, anon, authenticated;

create trigger expenses_recurring
before insert or update on public.expenses
for each row execute function private.apply_expense_recurring();

-- ── 2. Rules ───────────────────────────────────────────────────────────

create table public.recurring_rules (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  description text not null,
  amount_paise bigint not null,
  category text not null default 'general',
  category_label text,
  note text,
  split_input jsonb not null,
  payers jsonb not null,
  shares jsonb not null,
  frequency text not null,
  start_date date not null,
  end_date date,
  time_zone text not null,
  created_by_member_id uuid not null references public.members (id),
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  version integer not null default 0,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  constraint recurring_rules_description_check check (char_length(description) between 1 and 500),
  constraint recurring_rules_amount_check check (amount_paise > 0 and amount_paise <= 1000000000000),
  constraint recurring_rules_category_check check (category in (
    'general', 'food', 'groceries', 'travel', 'transport',
    'stay', 'shopping', 'utilities', 'entertainment', 'other'
  )),
  constraint recurring_rules_category_label_check check (
    category_label is null
    or (category = 'other' and char_length(category_label) between 1 and 30
        and category_label = btrim(category_label) and category_label !~ '[[:cntrl:]]')
  ),
  constraint recurring_rules_note_check check (
    note is null
    or (char_length(note) between 1 and 500 and note = btrim(note, E' \n\t')
        and note !~ E'[\\x01-\\x08\\x0B-\\x1F\\x7F]' and note !~ E'\n\n\n')
  ),
  constraint recurring_rules_split_check check (jsonb_typeof(split_input) = 'object'),
  constraint recurring_rules_lines_check check (
    jsonb_typeof(payers) = 'array' and jsonb_array_length(payers) between 1 and 200
    and jsonb_typeof(shares) = 'array' and jsonb_array_length(shares) between 1 and 200
  ),
  constraint recurring_rules_frequency_check check (frequency in ('weekly', 'monthly', 'yearly')),
  constraint recurring_rules_dates_check check (end_date is null or end_date >= start_date),
  constraint recurring_rules_time_zone_check check (
    char_length(time_zone) <= 64 and time_zone ~ '^([A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}|UTC)$'
  )
);

create index recurring_rules_group_idx on public.recurring_rules (group_id);
create index recurring_rules_change_xid_idx on public.recurring_rules (change_xid);

create trigger recurring_rules_touch
  before insert or update on public.recurring_rules
  for each row execute function private.touch_versioned_row();

create trigger recurring_rules_group_fixed
  before update on public.recurring_rules
  for each row execute function private.forbid_group_change();

alter table public.recurring_rules enable row level security;

create policy "Members read group recurring rules" on public.recurring_rules
  for select to authenticated
  using (group_id in (select private.my_group_ids()));

grant select on public.recurring_rules to authenticated;
grant select, insert, update, delete on public.recurring_rules to service_role;

-- ── 3. Group currency: rules count as money in the group ───────────────

create or replace function private.apply_group_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := private.push_setting('app.push_group_currency');
begin
  if v_map is not null and v_map ? new.id::text then
    new.currency := v_map ->> new.id::text;
  elsif tg_op = 'UPDATE' then
    new.currency := old.currency; -- old builds don't send it: keep
  end if;

  if tg_op = 'UPDATE' and new.currency is distinct from old.currency and (
       exists (select 1 from public.expenses e where e.group_id = new.id)
       or exists (select 1 from public.settlements s where s.group_id = new.id)
       or exists (select 1 from public.recurring_rules r where r.group_id = new.id)
     ) then
    raise exception 'group currency is locked once the group has expenses, payments or recurring expenses'
      using errcode = '23C01';
  end if;
  return new;
end;
$$;


-- ── 4. apply_push: occurrence links for expenses, then rules ───────────
-- Same layering as before: the previous public.apply_push (notes/receipts) moves to private.

alter function public.apply_push(uuid, jsonb) set schema private;
alter function private.apply_push(uuid, jsonb) rename to apply_push_extras;

revoke execute on function private.apply_push_extras(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.apply_push_extras(uuid, jsonb) to service_role;

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_result jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  r jsonb;
  v_id uuid;
  v_group uuid;
  v_cur_group uuid;
  v_cur_version integer;
  v_exists boolean;
  v_currency text;
  v_version integer;
begin
  -- { "<expense id>": { "r": rule id | null, "d": date | null } } for rows that carry the keys.
  perform set_config('app.push_expense_recurring', coalesce((
    select jsonb_object_agg(
      lower(x.value->>'id'),
      jsonb_build_object('r', x.value->'recurring_rule_id', 'd', x.value->'occurrence_date'))
    from jsonb_array_elements(coalesce(p_batch->'expenses', '[]'::jsonb)) x
    where jsonb_typeof(x.value) = 'object'
      and x.value->>'id' ~ c_uuid
      and x.value ? 'recurring_rule_id'
      and jsonb_typeof(x.value->'recurring_rule_id') in ('string', 'null')
      and jsonb_typeof(x.value->'occurrence_date') in ('string', 'null')
  ), '{}'::jsonb)::text, true);

  v_result := private.apply_push_extras(p_user, p_batch - 'recurring_rules');
  perform set_config('app.push_expense_recurring', '', true);

  -- Rules last: a rule may belong to a group or member created earlier in this same batch.
  for r in select value from jsonb_array_elements(coalesce(p_batch->'recurring_rules', '[]'::jsonb))
  loop
    begin
      v_id := (r->>'id')::uuid;
      v_group := (r->>'group_id')::uuid;
      select x.group_id, x.version into v_cur_group, v_cur_version
      from public.recurring_rules x where x.id = v_id for update;
      v_exists := found;

      if (v_exists and v_cur_group <> v_group) or not private.is_active_member(p_user, v_group) then
        v_rejected := v_rejected || jsonb_build_object('table', 'recurring_rules', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      end if;
      if v_exists and v_cur_version is distinct from (r->>'base_version')::integer then
        v_conflicts := v_conflicts || jsonb_build_object('table', 'recurring_rules', 'id', v_id, 'server_version', v_cur_version);
        continue;
      end if;

      -- Amounts are in the group currency; FOR SHARE orders this against a currency change.
      select g.currency into v_currency from public.groups g where g.id = v_group for share;
      if r->>'group_currency' is distinct from v_currency then
        v_rejected := v_rejected || jsonb_build_object('table', 'recurring_rules', 'id', v_id, 'code', 'CURRENCY_MISMATCH');
        continue;
      end if;

      if not private.member_in_group((r->>'created_by_member_id')::uuid, v_group)
         or exists (
           select 1 from jsonb_array_elements(
             case when jsonb_typeof(r->'payers') = 'array' then r->'payers' else '[]'::jsonb end
             || case when jsonb_typeof(r->'shares') = 'array' then r->'shares' else '[]'::jsonb end) l
           where not private.member_in_group((l.value->>'member_id')::uuid, v_group)
         ) then
        v_rejected := v_rejected || jsonb_build_object('table', 'recurring_rules', 'id', v_id, 'code', 'UNKNOWN_MEMBER');
        continue;
      end if;

      if v_exists then
        update public.recurring_rules
        set description = r->>'description',
            amount_paise = (r->>'amount_paise')::bigint,
            category = coalesce(r->>'category', 'general'),
            category_label = r->>'category_label',
            note = r->>'note',
            split_input = r->'split_input',
            payers = r->'payers',
            shares = r->'shares',
            frequency = r->>'frequency',
            start_date = (r->>'start_date')::date,
            end_date = (r->>'end_date')::date,
            time_zone = r->>'time_zone',
            updated_at = (r->>'updated_at')::bigint,
            deleted_at = (r->>'deleted_at')::bigint
        where id = v_id
        returning version into v_version;
      else
        insert into public.recurring_rules (
          id, group_id, description, amount_paise, category, category_label, note, split_input,
          payers, shares, frequency, start_date, end_date, time_zone, created_by_member_id,
          created_at, updated_at, deleted_at)
        values (
          v_id, v_group, r->>'description', (r->>'amount_paise')::bigint,
          coalesce(r->>'category', 'general'), r->>'category_label', r->>'note', r->'split_input',
          r->'payers', r->'shares', r->>'frequency', (r->>'start_date')::date,
          (r->>'end_date')::date, r->>'time_zone', (r->>'created_by_member_id')::uuid,
          (r->>'created_at')::bigint, (r->>'updated_at')::bigint, (r->>'deleted_at')::bigint)
        returning version into v_version;
      end if;

      v_applied := v_applied || jsonb_build_object('table', 'recurring_rules', 'id', v_id, 'version', v_version);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object(
        'table', 'recurring_rules', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
    end;
  end loop;

  return v_result || jsonb_build_object(
    'applied', coalesce(v_result->'applied', '[]'::jsonb) || v_applied,
    'conflicts', coalesce(v_result->'conflicts', '[]'::jsonb) || v_conflicts,
    'rejected', coalesce(v_result->'rejected', '[]'::jsonb) || v_rejected);
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

-- ── 5. pull_page: rules travel too ─────────────────────────────────────
-- Identical to the multi-currency version except ord 5 (recurring_rules). Builds that don't know
-- the key ignore it.

create or replace function public.pull_page(
  p_cursor text default null,
  p_full_group_ids uuid[] default '{}',
  p_limit integer default 300
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_full uuid[] := coalesce(p_full_group_ids, '{}');
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
  v_lower xid8;
  v_upper xid8;
  v_ord integer := -1;
  v_xid xid8 := '0'::xid8;
  v_id uuid := '00000000-0000-0000-0000-000000000000';
  v_keys jsonb;
  v_more boolean;
  v_last jsonb;
  v_cursor text;
  v_g uuid[];
  v_m uuid[];
  v_e uuid[];
  v_s uuid[];
  v_a uuid[];
  v_r uuid[];
begin
  if cardinality(v_full) > 50 then
    raise exception 'pull_page: at most 50 groups per full fetch' using errcode = '22023';
  end if;

  if p_cursor like 'p2:%' then
    if p_cursor !~ '^p2:[0-9]+:[0-9]+:[0-5]:[0-9]+:[0-9a-fA-F-]{36}$' then
      raise exception 'pull_page: invalid cursor' using errcode = '22023';
    end if;
    v_lower := split_part(p_cursor, ':', 2)::xid8;
    v_upper := split_part(p_cursor, ':', 3)::xid8;
    v_ord := split_part(p_cursor, ':', 4)::integer;
    v_xid := split_part(p_cursor, ':', 5)::xid8;
    v_id := split_part(p_cursor, ':', 6)::uuid;
  elsif coalesce(p_cursor, '') !~ '^[0-9]*$' then
    raise exception 'pull_page: invalid cursor' using errcode = '22023';
  else
    v_lower := coalesce(nullif(p_cursor, '')::xid8, '0'::xid8);
    v_upper := pg_snapshot_xmin(pg_current_snapshot());
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('o', k.ord, 'x', k.x::text, 'i', k.id)
                            order by k.ord, k.x, k.id), '[]'::jsonb)
  into v_keys
  from (
    select ord, x, id
    from (
      select 0 as ord, g.change_xid as x, g.id from public.groups g
      where g.id = any(v_full) or (g.change_xid >= v_lower and g.change_xid < v_upper)
      union all
      select 1, m.change_xid, m.id from public.members m
      where m.group_id = any(v_full) or (m.change_xid >= v_lower and m.change_xid < v_upper)
      union all
      select 2, e.change_xid, e.id from public.expenses e
      where e.group_id = any(v_full) or (e.change_xid >= v_lower and e.change_xid < v_upper)
      union all
      select 3, s.change_xid, s.id from public.settlements s
      where s.group_id = any(v_full) or (s.change_xid >= v_lower and s.change_xid < v_upper)
      union all
      select 4, a.change_xid, a.id from public.activity_log a
      where a.group_id = any(v_full) or (a.change_xid >= v_lower and a.change_xid < v_upper)
      union all
      select 5, r.change_xid, r.id from public.recurring_rules r
      where r.group_id = any(v_full) or (r.change_xid >= v_lower and r.change_xid < v_upper)
    ) candidates
    where (ord, x, id) > (v_ord, v_xid, v_id)
    order by ord, x, id
    limit v_limit + 1
  ) k;

  v_more := jsonb_array_length(v_keys) > v_limit;
  if v_more then
    v_keys := v_keys - v_limit;
    v_last := v_keys -> (v_limit - 1);
    v_cursor := format('p2:%s:%s:%s:%s:%s', v_lower, v_upper, v_last->>'o', v_last->>'x', v_last->>'i');
  else
    v_cursor := v_upper::text;
  end if;

  select
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 0), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 1), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 2), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 3), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 4), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 5), '{}')
  into v_g, v_m, v_e, v_s, v_a, v_r
  from jsonb_array_elements(v_keys) k;

  return jsonb_build_object(
    'cursor', v_cursor,
    'more', v_more,
    'group_ids', coalesce((select jsonb_agg(t.id) from private.my_group_ids() as t(id)), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(to_jsonb(g) - 'change_xid' - 'server_updated_at' order by g.change_xid, g.id)
      from public.groups g where g.id = any(v_g)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) - 'change_xid' - 'server_updated_at' order by m.change_xid, m.id)
      from public.members m where m.id = any(v_m)
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(
        (to_jsonb(e) - 'change_xid' - 'server_updated_at') || jsonb_build_object(
          'payers', coalesce((
            -- strip_nulls: original_amount_minor only appears on foreign bills, matching the app.
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'member_id', p.member_id,
                     'amount_paise', p.amount_paise,
                     'original_amount_minor', p.original_amount_minor))
                   order by p.member_id)
            from public.expense_payers p where p.expense_id = e.id
          ), '[]'::jsonb),
          'shares', coalesce((
            select jsonb_agg(jsonb_build_object('member_id', s.member_id, 'amount_paise', s.amount_paise)
                             order by s.member_id)
            from public.expense_shares s where s.expense_id = e.id
          ), '[]'::jsonb)
        )
        order by e.change_xid, e.id
      )
      from public.expenses e where e.id = any(v_e)
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(to_jsonb(s) - 'change_xid' - 'server_updated_at' order by s.change_xid, s.id)
      from public.settlements s where s.id = any(v_s)
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(a) - 'change_xid' - 'server_updated_at' order by a.change_xid, a.id)
      from public.activity_log a where a.id = any(v_a)
    ), '[]'::jsonb),
    'recurring_rules', coalesce((
      select jsonb_agg(to_jsonb(r) - 'change_xid' - 'server_updated_at' order by r.change_xid, r.id)
      from public.recurring_rules r where r.id = any(v_r)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.pull_page(text, uuid[], integer) from public, anon;
grant execute on function public.pull_page(text, uuid[], integer) to authenticated;

-- ── 6. The generator ───────────────────────────────────────────────────

create function private.generate_recurring_occurrences(
  p_now timestamptz default now(),
  p_limit integer default 24
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_ns constant uuid := '5c1e9a52-4b7d-4f2e-9d0a-3c8b6e2f1a47';
  v_rule public.recurring_rules;
  v_today date;
  v_date date;
  v_id uuid;
  v_made integer;
  v_total integer := 0;
  v_ms bigint := (extract(epoch from p_now) * 1000)::bigint;
  v_groups uuid[] := '{}';
  v_group uuid;
begin
  for v_rule in
    select r.* from public.recurring_rules r
    join public.groups g on g.id = r.group_id
    where r.deleted_at is null and g.deleted_at is null
    order by r.id
  loop
    begin
      v_today := (p_now at time zone v_rule.time_zone)::date;
    exception when others then
      v_today := (p_now at time zone 'UTC')::date; -- unknown zone name: UTC rather than nothing
    end;

    -- Someone on the rule has left (or isn't in the group): wait until the rule is edited.
    if exists (
      select 1 from jsonb_array_elements(v_rule.payers || v_rule.shares) l
      where not exists (
        select 1 from public.members m
        where m.id = (l.value->>'member_id')::uuid and m.group_id = v_rule.group_id and m.deleted_at is null)
    ) then
      continue;
    end if;

    v_made := 0;
    for n in 0..999 loop
      v_date := case v_rule.frequency
        when 'weekly' then v_rule.start_date + 7 * n
        when 'monthly' then (v_rule.start_date + make_interval(months => n))::date
        else (v_rule.start_date + make_interval(years => n))::date
      end;
      exit when v_date > v_today
        or (v_rule.end_date is not null and v_date > v_rule.end_date)
        or v_made >= p_limit;

      v_id := extensions.uuid_generate_v5(c_ns, v_rule.id::text || '/' || to_char(v_date, 'YYYY-MM-DD'));
      -- An existing row (made by a phone, or deleted by someone) is never touched.
      insert into public.expenses (
        id, group_id, description, amount_paise, category, category_label, expense_date,
        split_input, created_by_member_id, created_at, updated_at, deleted_at, note,
        recurring_rule_id, occurrence_date)
      values (
        v_id, v_rule.group_id, v_rule.description, v_rule.amount_paise, v_rule.category,
        v_rule.category_label, v_date, v_rule.split_input, v_rule.created_by_member_id,
        v_ms, v_ms, null, v_rule.note, v_rule.id, v_date)
      on conflict (id) do nothing;

      if found then
        insert into public.expense_payers (expense_id, member_id, amount_paise)
        select v_id, (l.value->>'member_id')::uuid, (l.value->>'amount_paise')::bigint
        from jsonb_array_elements(v_rule.payers) l;
        insert into public.expense_shares (expense_id, member_id, amount_paise)
        select v_id, (l.value->>'member_id')::uuid, (l.value->>'amount_paise')::bigint
        from jsonb_array_elements(v_rule.shares) l;
        insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, after, created_at)
        values (
          extensions.uuid_generate_v5(c_ns, v_rule.id::text || '/' || to_char(v_date, 'YYYY-MM-DD') || '/activity'),
          v_rule.group_id, 'expense', v_id, 'create', null,
          jsonb_build_object(
            'description', v_rule.description,
            'amountPaise', v_rule.amount_paise,
            'category', v_rule.category,
            'expenseDate', to_char(v_date, 'YYYY-MM-DD'),
            'payers', (select jsonb_agg(jsonb_build_object('memberId', l.value->>'member_id',
                                                           'amountPaise', (l.value->>'amount_paise')::bigint))
                       from jsonb_array_elements(v_rule.payers) l),
            'shares', (select jsonb_agg(jsonb_build_object('memberId', l.value->>'member_id',
                                                           'amountPaise', (l.value->>'amount_paise')::bigint))
                       from jsonb_array_elements(v_rule.shares) l),
            'recurringRuleId', v_rule.id,
            'frequency', v_rule.frequency),
          v_ms)
        on conflict (id) do nothing;
        v_made := v_made + 1;
        v_total := v_total + 1;
        if not (v_rule.group_id = any(v_groups)) then
          v_groups := v_groups || v_rule.group_id;
        end if;
      end if;
    end loop;
  end loop;

  -- Tell open phones to pull (same data-free signal as sync-push). Best effort.
  foreach v_group in array v_groups loop
    begin
      perform realtime.send(jsonb_build_object('origin', 'server-recurring'), 'changed',
                            'group:' || v_group::text, true);
    exception when others then
      null;
    end;
  end loop;

  return v_total;
end;
$$;

revoke execute on function private.generate_recurring_occurrences(timestamptz, integer) from public, anon, authenticated;
grant execute on function private.generate_recurring_occurrences(timestamptz, integer) to service_role;

-- Hourly, a few minutes past: every time zone's midnight is covered within the hour.
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('recurring-occurrences', '7 * * * *',
                          'select private.generate_recurring_occurrences()');
  end if;
end;
$outer$;

notify pgrst, 'reload schema';
