-- Multi-currency (pre-release step 1).
--
-- * Each group has one currency (ISO 4217), chosen at creation. It can change only while the group
--   has no expense or settlement rows at all, deleted ones included (a restore would bring back
--   amounts in the old currency).
-- * Every amount column stays "minor units of the group currency" (columns keep their _paise names).
-- * A foreign bill keeps what was typed: original_currency, original_amount_minor and the locked
--   fx_rate (exact decimal TEXT, never numeric/float, so it round-trips byte for byte and sync
--   conflict checks compare equal). amount_paise is the converted total; payers/shares are already
--   converted. The Edge Function re-checks all of that math with src/domain before it gets here.
-- * Pushes carry `group_currency` on expenses and settlements: the currency the phone believes the
--   amounts are in. A mismatch is refused. Rows WITHOUT it come from builds older than this
--   migration; those are refused in non-INR groups (they would read ¥1,000 as ₹10.00) and may not
--   edit foreign bills (they don't know the columns).
-- * Daily exchange rates live in private.fx_rates, filled by the fx-refresh Edge Function from a
--   pg_cron job, readable by anyone (signed in or not) through public.fx_rates().
--
-- apply_push_core writes rows with fixed column lists. As with category labels, the new values travel
-- in transaction-local settings published by public.apply_push and BEFORE triggers copy them in.

-- ── 1. Columns and rules ───────────────────────────────────────────────

alter table public.groups add column currency text not null default 'INR';
alter table public.groups add constraint groups_currency_check check (currency ~ '^[A-Z]{3}$');

alter table public.expenses
  add column original_currency text,
  add column original_amount_minor bigint,
  add column fx_rate text;

alter table public.expenses add constraint expenses_foreign_check check (
  (original_currency is null and original_amount_minor is null and fx_rate is null)
  or (
    -- Explicit NOT NULLs: a NULL inside the AND would make the whole CHECK NULL, i.e. pass.
    original_currency is not null and original_amount_minor is not null and fx_rate is not null
    and original_currency ~ '^[A-Z]{3}$'
    and original_amount_minor > 0 and original_amount_minor <= 1000000000000
    -- Canonical decimal as produced by src/domain/fx.ts parseRate: no leading/trailing zeros.
    and fx_rate ~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{0,13}[1-9])?$'
    and fx_rate !~ '^0$'
  )
);

alter table public.expense_payers add column original_amount_minor bigint;
alter table public.expense_payers add constraint expense_payers_original_check check (
  original_amount_minor is null or (original_amount_minor >= 0 and original_amount_minor <= 1000000000000)
);

-- One ceiling for every currency (src/domain/currency.ts MAX_AMOUNT_MINOR_ANY). The app applies a
-- per-currency cap below it (₹1 crore stays ₹1 crore). Still far inside Number.MAX_SAFE_INTEGER.
alter table public.expenses drop constraint expenses_amount_check;
alter table public.expenses add constraint expenses_amount_check
  check (amount_paise > 0 and amount_paise <= 1000000000000);
alter table public.expense_payers drop constraint expense_payers_amount_check;
alter table public.expense_payers add constraint expense_payers_amount_check
  check (amount_paise >= 0 and amount_paise <= 1000000000000);
alter table public.expense_shares drop constraint expense_shares_amount_check;
alter table public.expense_shares add constraint expense_shares_amount_check
  check (amount_paise >= 0 and amount_paise <= 1000000000000);
alter table public.settlements drop constraint settlements_amount_check;
alter table public.settlements add constraint settlements_amount_check
  check (amount_paise > 0 and amount_paise <= 1000000000000);

-- Custom SQLSTATEs in class 23 (integrity constraint violation): apply_push_core already turns any
-- class-23 error into a per-row rejection, and public.apply_push maps these to readable codes.
--   23C01 CURRENCY_LOCKED   group currency change while the group has expenses/settlements
--   23C02 CURRENCY_MISMATCH row's group_currency differs from the group's currency
--   23C03 UPGRADE_REQUIRED  old build writing to a non-INR group or editing a foreign bill

create function private.push_setting(p_name text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  -- Null outside a push: the triggers below then leave rows alone.
  select nullif(current_setting(p_name, true), '')::jsonb;
$$;

revoke execute on function private.push_setting(text) from public, anon, authenticated;
-- Called from the triggers below, which run as the writer (service_role in apply_push).
grant execute on function private.push_setting(text) to service_role;

-- ── 2. Groups: currency from the push; locked once there is money ──────

create function private.apply_group_currency()
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
     ) then
    raise exception 'group currency is locked once the group has expenses or payments'
      using errcode = '23C01';
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_group_currency() from public, anon, authenticated;

create trigger groups_currency
before insert or update on public.groups
for each row execute function private.apply_group_currency();

-- ── 3. Expenses: foreign columns from the push; currency agreement ─────

-- FOR SHARE on the group row: a concurrent currency change (FOR NO KEY UPDATE) waits for this
-- transaction, and its lock check then sees this expense; or this waits for it and sees the new
-- currency. Either way the two can't both commit with mismatched amounts.
create function private.locked_group_currency(p_group uuid)
returns text
language sql
volatile
set search_path = ''
as $$
  select g.currency from public.groups g where g.id = p_group for share;
$$;

revoke execute on function private.locked_group_currency(uuid) from public, anon, authenticated;
grant execute on function private.locked_group_currency(uuid) to service_role;

create function private.apply_expense_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := private.push_setting('app.push_expense_fx');
  v_row jsonb;
  v_group_currency text;
begin
  if v_map is null then
    return new; -- not a push
  end if;

  v_group_currency := private.locked_group_currency(new.group_id);
  v_row := v_map -> new.id::text;

  if v_row is null then
    -- A build from before multi-currency.
    if v_group_currency is distinct from 'INR' then
      raise exception 'update the app to add expenses to a % group', v_group_currency using errcode = '23C03';
    end if;
    if tg_op = 'UPDATE' and old.original_currency is not null then
      raise exception 'update the app to edit a foreign-currency expense' using errcode = '23C03';
    end if;
    if tg_op = 'UPDATE' then
      new.original_currency := old.original_currency;
      new.original_amount_minor := old.original_amount_minor;
      new.fx_rate := old.fx_rate;
    end if;
    return new;
  end if;

  if v_row ->> 'g' is distinct from v_group_currency then
    raise exception 'amounts are in %, the group is in %', v_row ->> 'g', v_group_currency
      using errcode = '23C02';
  end if;

  new.original_currency := v_row ->> 'c';
  new.original_amount_minor := (v_row ->> 'a')::bigint;
  new.fx_rate := v_row ->> 'r';
  if new.original_currency = v_group_currency then
    raise exception 'a foreign bill must be in another currency' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_expense_currency() from public, anon, authenticated;

create trigger expenses_currency
before insert or update on public.expenses
for each row execute function private.apply_expense_currency();

-- Payer lines are rewritten with every expense push; originals come from the same setting.
create function private.apply_payer_original()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := private.push_setting('app.push_expense_fx');
begin
  if v_map is not null then
    new.original_amount_minor := (v_map -> new.expense_id::text -> 'p' ->> new.member_id::text)::bigint;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_payer_original() from public, anon, authenticated;

create trigger expense_payers_original
before insert on public.expense_payers
for each row execute function private.apply_payer_original();

-- ── 4. Settlements: currency agreement ─────────────────────────────────

create function private.check_settlement_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := private.push_setting('app.push_settlement_currency');
  v_group_currency text;
begin
  if v_map is null then
    return new;
  end if;
  v_group_currency := private.locked_group_currency(new.group_id);
  if not v_map ? new.id::text then
    if v_group_currency is distinct from 'INR' then
      raise exception 'update the app to record payments in a % group', v_group_currency using errcode = '23C03';
    end if;
  elsif v_map ->> new.id::text is distinct from v_group_currency then
    raise exception 'amount is in %, the group is in %', v_map ->> new.id::text, v_group_currency
      using errcode = '23C02';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_settlement_currency() from public, anon, authenticated;

create trigger settlements_currency
before insert or update on public.settlements
for each row execute function private.check_settlement_currency();

-- ── 5. apply_push: publish labels + currency data, map error codes ─────
-- Same name and signature: the Edge Function needs no change to call it.

create or replace function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_result jsonb;
begin
  -- { "<expense id>": "Petrol" | null } for rows that carry the key (custom categories).
  perform set_config('app.push_category_labels', coalesce((
    select jsonb_object_agg(lower(r.value->>'id'), r.value->'category_label')
    from jsonb_array_elements(coalesce(p_batch->'expenses', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and r.value ? 'category_label'
      and jsonb_typeof(r.value->'category_label') in ('string', 'null')
      and r.value->>'id' ~ c_uuid
  ), '{}'::jsonb)::text, true);

  -- { "<group id>": "AED" } for group rows that carry a currency.
  perform set_config('app.push_group_currency', coalesce((
    select jsonb_object_agg(lower(r.value->>'id'), r.value->'currency')
    from jsonb_array_elements(coalesce(p_batch->'groups', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and jsonb_typeof(r.value->'currency') = 'string'
      and r.value->>'id' ~ c_uuid
  ), '{}'::jsonb)::text, true);

  -- { "<expense id>": { g: group currency, c/a/r: bill currency/amount/rate, p: {member: original} } }
  -- for expense rows from builds that know currencies (they always send group_currency).
  -- Non-numeric amounts or ids become nulls here and fail the column CHECK/casts per row.
  perform set_config('app.push_expense_fx', coalesce((
    select jsonb_object_agg(
      lower(r.value->>'id'),
      jsonb_build_object(
        'g', r.value->>'group_currency',
        'c', r.value->>'original_currency',
        'a', case when jsonb_typeof(r.value->'original_amount_minor') = 'number'
                  then r.value->'original_amount_minor' end,
        'r', r.value->>'fx_rate',
        'p', coalesce((
          select jsonb_object_agg(lower(l.value->>'member_id'), l.value->'original_amount_minor')
          from jsonb_array_elements(case when jsonb_typeof(r.value->'payers') = 'array'
                                         then r.value->'payers' else '[]'::jsonb end) l
          where jsonb_typeof(l.value) = 'object'
            and jsonb_typeof(l.value->'original_amount_minor') = 'number'
            and r.value->>'original_currency' is not null
        ), '{}'::jsonb)
      )
    )
    from jsonb_array_elements(coalesce(p_batch->'expenses', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and jsonb_typeof(r.value->'group_currency') = 'string'
      and r.value->>'id' ~ c_uuid
  ), '{}'::jsonb)::text, true);

  perform set_config('app.push_settlement_currency', coalesce((
    select jsonb_object_agg(lower(r.value->>'id'), r.value->'group_currency')
    from jsonb_array_elements(coalesce(p_batch->'settlements', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and jsonb_typeof(r.value->'group_currency') = 'string'
      and r.value->>'id' ~ c_uuid
  ), '{}'::jsonb)::text, true);

  v_result := private.apply_push_guarded(p_user, p_batch);

  -- The settings live until the transaction ends; clear them so nothing after this call in the same
  -- transaction (tests, future callers) is treated as part of the push.
  perform set_config('app.push_group_currency', '', true);
  perform set_config('app.push_expense_fx', '', true);
  perform set_config('app.push_settlement_currency', '', true);

  return v_result || jsonb_build_object('rejected', coalesce((
    select jsonb_agg(
      case r.value->>'detail'
        when '23C01' then r.value || '{"code":"CURRENCY_LOCKED"}'::jsonb
        when '23C02' then r.value || '{"code":"CURRENCY_MISMATCH"}'::jsonb
        when '23C03' then r.value || '{"code":"UPGRADE_REQUIRED"}'::jsonb
        else r.value
      end
    )
    from jsonb_array_elements(coalesce(v_result->'rejected', '[]'::jsonb)) r
  ), '[]'::jsonb));
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

-- ── 6. pull_page: payer lines carry the original amount (foreign bills only) ──
-- Identical to 20261009150000_pull_page.sql except the payers object. pull_changes (old builds)
-- is left alone: those builds don't know original amounts.

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
begin
  if cardinality(v_full) > 50 then
    raise exception 'pull_page: at most 50 groups per full fetch' using errcode = '22023';
  end if;

  if p_cursor like 'p2:%' then
    if p_cursor !~ '^p2:[0-9]+:[0-9]+:[0-4]:[0-9]+:[0-9a-fA-F-]{36}$' then
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
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 4), '{}')
  into v_g, v_m, v_e, v_s, v_a
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
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.pull_page(text, uuid[], integer) from public, anon;
grant execute on function public.pull_page(text, uuid[], integer) to authenticated;

-- ── 7. Daily exchange rates ────────────────────────────────────────────

create table private.fx_rates (
  code text primary key,
  -- Units of `code` per 1 USD, canonical decimal (same format as expenses.fx_rate).
  per_usd text not null,
  -- The provider's date for the rate (central banks publish on working days).
  as_of date not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  constraint fx_rates_code_check check (code ~ '^[A-Z]{3}$'),
  constraint fx_rates_per_usd_check check (
    per_usd ~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{0,13}[1-9])?$' and per_usd !~ '^0$'
  ),
  constraint fx_rates_source_check check (source in ('frankfurter', 'exchangerate-api'))
);

-- Writer: only the fx-refresh Edge Function (secret key). Rows that fail a CHECK are skipped, not
-- fatal, so one odd value from a feed can't block the rest.
create function public.fx_rates_upsert(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_count integer := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 400 then
    raise exception 'fx_rates_upsert: an array of at most 400 rows is required' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_rows)
  loop
    begin
      insert into private.fx_rates (code, per_usd, as_of, source, fetched_at)
      values (r->>'code', r->>'per_usd', (r->>'as_of')::date, r->>'source', now())
      on conflict (code) do update
        set per_usd = excluded.per_usd, as_of = excluded.as_of, source = excluded.source,
            fetched_at = excluded.fetched_at
        -- Never replace a newer rate with an older one (e.g. the fallback feed lagging a day).
        where private.fx_rates.as_of <= excluded.as_of;
      v_count := v_count + 1;
    exception when integrity_constraint_violation or data_exception then
      null;
    end;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.fx_rates_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.fx_rates_upsert(jsonb) to service_role;

-- Reader: public data, so anon too (sign-in is optional in the app). Compact shape, ~6 KB:
-- { "rates": { "INR": ["96.64", "2026-10-10", "frankfurter"], ... } }
create function public.fx_rates()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('rates', coalesce(
    jsonb_object_agg(f.code, jsonb_build_array(f.per_usd, f.as_of::text, f.source)),
    '{}'::jsonb))
  from private.fx_rates f;
$$;

revoke execute on function public.fx_rates() from public;
grant execute on function public.fx_rates() to anon, authenticated, service_role;

-- ── 8. Schedule (pg_cron + pg_net) ─────────────────────────────────────
-- Twice a day (UTC): 00:20 picks up yesterday's full set for Indian mornings, 16:20 catches the ECB
-- and most central banks' same-day publications. The URL and secret come from Vault, so nothing
-- secret is in this file. Set them once (SQL editor):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/fx-refresh', 'fx_refresh_url');
--   select vault.create_secret('<random 32+ chars>', 'fx_cron_secret');
-- and the same secret for the function: npx supabase secrets set FX_CRON_SECRET=<same value>.
-- Skipped where the extensions aren't available (local Postgres used for the smoke tests).
do $outer$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
    perform cron.schedule('fx-refresh-am', '20 0 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fx_refresh_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fx_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000)
    $job$);
    perform cron.schedule('fx-refresh-pm', '20 16 * * *', $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fx_refresh_url'),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fx_cron_secret')),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000)
    $job$);
  end if;
end;
$outer$;

notify pgrst, 'reload schema';
