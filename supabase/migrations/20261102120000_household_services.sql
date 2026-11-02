-- Home services (milk, maid, newspaper, water cans…) inside a group.
--
-- * public.household_services: one row per service. Rates (with history), weekdays, paid leaves and
--   the bills already posted ('YYYY-MM' → expense id) live on the row. Amounts are minor units of
--   the group currency, so a service locks the group currency like an expense does.
-- * public.household_marks: only the days that weren't as usual. The id is derived from
--   (service, date) exactly as src/domain/household.ts computes it, so two phones marking the same
--   day write the same row. Marks are never deleted: qty null = back to usual (the version carries
--   on, so a stale phone is caught).
-- * A posted bill is an ordinary expense (planned by the api function with src/domain), so
--   balances, settle-up and history need nothing new.
-- * Only the api Edge Function writes (service role, through api_apply → apply_push). Clients read
--   through get_group / list_groups snapshots, which now carry both tables.
-- * Builds from before this migration (sync-push) never send these keys and never see them.

-- ── 1. Checks shared by the table constraints ──────────────────────────

-- Rates: [{from: 'YYYY-MM-DD', rate_paise: 1..1e9}], strictly by date, the first on start_date.
create function private.valid_household_rates(p_rates jsonb, p_start date)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  r jsonb;
  v_prev date;
  v_from date;
  v_first boolean := true;
begin
  if jsonb_typeof(p_rates) <> 'array' or jsonb_array_length(p_rates) not between 1 and 24 then
    return false;
  end if;
  for r in select value from jsonb_array_elements(p_rates) loop
    if jsonb_typeof(r) <> 'object' or jsonb_typeof(r->'rate_paise') <> 'number'
       or (r->>'from') !~ '^\d{4}-\d{2}-\d{2}$' then
      return false;
    end if;
    v_from := (r->>'from')::date;
    if (r->>'rate_paise')::numeric <> trunc((r->>'rate_paise')::numeric)
       or (r->>'rate_paise')::numeric not between 1 and 1000000000 then
      return false;
    end if;
    if v_first and v_from <> p_start then return false; end if;
    if not v_first and v_from <= v_prev then return false; end if;
    v_prev := v_from;
    v_first := false;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- Bills: { 'YYYY-MM': '<expense uuid>' }.
create function private.valid_household_bills(p_bills jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_bills) = 'object'
     and (select count(*) from jsonb_object_keys(p_bills)) <= 1000
     and not exists (
       select 1 from jsonb_each(p_bills) b
       where b.key !~ '^\d{4}-(0[1-9]|1[0-2])$'
          or jsonb_typeof(b.value) <> 'string'
          or (b.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     );
$$;

revoke execute on function private.valid_household_rates(jsonb, date) from public, anon, authenticated;
revoke execute on function private.valid_household_bills(jsonb) from public, anon, authenticated;
grant execute on function private.valid_household_rates(jsonb, date) to service_role;
grant execute on function private.valid_household_bills(jsonb) to service_role;

-- ── 2. Tables ──────────────────────────────────────────────────────────

create table public.household_services (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  name text not null,
  kind text not null,
  unit text,
  default_qty integer not null,
  rates jsonb not null,
  weekdays smallint not null,
  paid_leaves smallint not null default 0,
  start_date date not null,
  end_date date,
  bills jsonb not null default '{}'::jsonb,
  created_by_member_id uuid not null references public.members (id),
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  version integer not null default 0,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  constraint household_services_name_check check (
    char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'
  ),
  constraint household_services_kind_check check (kind in ('per_unit', 'monthly')),
  constraint household_services_unit_check check (
    (kind = 'monthly' and unit is null)
    or (kind = 'per_unit' and unit in ('L', 'kg', 'packet', 'can', 'paper', 'item'))
  ),
  constraint household_services_qty_check check (
    default_qty between 1 and 10000 and (kind = 'per_unit' or default_qty = 100)
  ),
  constraint household_services_rates_check check (private.valid_household_rates(rates, start_date)),
  constraint household_services_weekdays_check check (weekdays between 1 and 127),
  constraint household_services_leaves_check check (
    paid_leaves between 0 and 31 and (kind = 'monthly' or paid_leaves = 0)
  ),
  constraint household_services_dates_check check (end_date is null or end_date >= start_date),
  constraint household_services_bills_check check (private.valid_household_bills(bills))
);

create index household_services_group_change_idx on public.household_services (group_id, change_xid);

create table public.household_marks (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  service_id uuid not null references public.household_services (id),
  mark_date date not null,
  qty integer,
  marked_by_member_id uuid not null references public.members (id),
  created_at bigint not null,
  updated_at bigint not null,
  version integer not null default 0,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  constraint household_marks_qty_check check (qty is null or qty between 0 and 10000),
  -- Same id on every phone: duplicates collide instead of doubling up.
  constraint household_marks_id_check check (
    id = extensions.uuid_generate_v5(
      '3f6b2c1e-8d4a-4b7e-9c05-6a1d2e8f4b90'::uuid, service_id::text || '/' || to_char(mark_date, 'YYYY-MM-DD'))
  ),
  constraint household_marks_day_key unique (service_id, mark_date)
);

create index household_marks_group_change_idx on public.household_marks (group_id, change_xid);
create index household_marks_group_date_idx on public.household_marks (group_id, mark_date);

create trigger household_services_touch
  before insert or update on public.household_services
  for each row execute function private.touch_versioned_row();
create trigger household_services_group_fixed
  before update on public.household_services
  for each row execute function private.forbid_group_change();
create trigger household_marks_touch
  before insert or update on public.household_marks
  for each row execute function private.touch_versioned_row();
create trigger household_marks_group_fixed
  before update on public.household_marks
  for each row execute function private.forbid_group_change();

alter table public.household_services enable row level security;
alter table public.household_marks enable row level security;

create policy "Members read group home services" on public.household_services
  for select to authenticated
  using (group_id in (select private.my_group_ids()));
create policy "Members read group home service days" on public.household_marks
  for select to authenticated
  using (group_id in (select private.my_group_ids()));

grant select on public.household_services, public.household_marks to authenticated;
grant select, insert, update, delete on public.household_services, public.household_marks to service_role;

-- ── 3. Group currency: services count as money in the group ────────────
-- Same as the recurring version, plus household_services.

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
       or exists (select 1 from public.household_services h where h.group_id = new.id)
     ) then
    raise exception 'group currency is locked once the group has expenses, payments, recurring expenses or home services'
      using errcode = '23C01';
  end if;
  return new;
end;
$$;

-- ── 4. Snapshots carry the new tables ──────────────────────────────────

create or replace function private.group_rev(p_group uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select g.change_xid from public.groups g where g.id = p_group),
    (select max(m.change_xid) from public.members m where m.group_id = p_group),
    (select max(e.change_xid) from public.expenses e where e.group_id = p_group),
    (select max(s.change_xid) from public.settlements s where s.group_id = p_group),
    (select max(r.change_xid) from public.recurring_rules r where r.group_id = p_group),
    (select max(a.change_xid) from public.activity_log a where a.group_id = p_group),
    (select max(h.change_xid) from public.household_services h where h.group_id = p_group),
    (select max(k.change_xid) from public.household_marks k where k.group_id = p_group)
  )::text;
$$;

-- As in server_first_api, plus household_services (live ones) and their marks of the last 400
-- days. Older days can't be changed or billed any more (src/domain/household.ts: 366 days), so
-- the snapshot stays small on slow networks.
create or replace function private.group_snapshot(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rev', private.group_rev(g.id),
    'group', to_jsonb(g) - 'change_xid' - 'server_updated_at',
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) - 'change_xid' - 'server_updated_at' order by m.created_at, m.id)
      from public.members m where m.group_id = g.id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(
        (to_jsonb(e) - 'change_xid' - 'server_updated_at') || jsonb_build_object(
          'payers', coalesce((
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
          ), '[]'::jsonb))
        order by e.expense_date desc, e.created_at desc, e.id desc)
      from public.expenses e where e.group_id = g.id and e.deleted_at is null
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(to_jsonb(s) - 'change_xid' - 'server_updated_at' order by s.settled_at desc, s.id)
      from public.settlements s where s.group_id = g.id and s.deleted_at is null
    ), '[]'::jsonb),
    'recurring_rules', coalesce((
      select jsonb_agg(to_jsonb(r) - 'change_xid' - 'server_updated_at' order by r.created_at, r.id)
      from public.recurring_rules r where r.group_id = g.id and r.deleted_at is null
    ), '[]'::jsonb),
    -- Same rule as private.locked_group_currency: any row ever, deleted ones included.
    'currency_locked', exists (select 1 from public.expenses e where e.group_id = g.id)
                    or exists (select 1 from public.settlements s where s.group_id = g.id)
                    or exists (select 1 from public.recurring_rules r where r.group_id = g.id)
                    or exists (select 1 from public.household_services h where h.group_id = g.id),
    'rules_with_occurrences', coalesce((
      select jsonb_agg(distinct e.recurring_rule_id)
      from public.expenses e where e.group_id = g.id and e.recurring_rule_id is not null
    ), '[]'::jsonb),
    'household_services', coalesce((
      select jsonb_agg(to_jsonb(h) - 'change_xid' - 'server_updated_at' order by h.created_at, h.id)
      from public.household_services h where h.group_id = g.id and h.deleted_at is null
    ), '[]'::jsonb),
    'household_marks', coalesce((
      select jsonb_agg(to_jsonb(k) - 'change_xid' - 'server_updated_at' order by k.mark_date, k.service_id)
      from public.household_marks k
      join public.household_services h on h.id = k.service_id and h.deleted_at is null
      where k.group_id = g.id and k.mark_date >= current_date - 400
    ), '[]'::jsonb)
  )
  from public.groups g
  where g.id = p_group;
$$;

-- ── 5. apply_push: services and their days, after the existing layers ──
-- Same layering as before: the previous public.apply_push (pay methods) moves to private.

alter function public.apply_push(uuid, jsonb) set schema private;
alter function private.apply_push(uuid, jsonb) rename to apply_push_pay_methods;

revoke execute on function private.apply_push_pay_methods(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.apply_push_pay_methods(uuid, jsonb) to service_role;

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb;
  v_applied jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  r jsonb;
  v_id uuid;
  v_group uuid;
  v_service uuid;
  v_cur_group uuid;
  v_cur_service uuid;
  v_cur_version integer;
  v_exists boolean;
  v_currency text;
  v_version integer;
begin
  -- Services and marks last: a bill's expense (and a new service's group and members) come first.
  v_result := private.apply_push_pay_methods(p_user, p_batch - 'household_services' - 'household_marks');

  for r in select value from jsonb_array_elements(
    case when jsonb_typeof(p_batch->'household_services') = 'array' then p_batch->'household_services' else '[]'::jsonb end)
  loop
    begin
      v_id := (r->>'id')::uuid;
      v_group := (r->>'group_id')::uuid;
      select x.group_id, x.version into v_cur_group, v_cur_version
      from public.household_services x where x.id = v_id for update;
      v_exists := found;

      if (v_exists and v_cur_group <> v_group) or not private.is_active_member(p_user, v_group) then
        v_rejected := v_rejected || jsonb_build_object('table', 'household_services', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      end if;
      if (v_exists and v_cur_version is distinct from (r->>'base_version')::integer)
         or (not v_exists and coalesce((r->>'base_version')::integer, 0) <> 0) then
        v_conflicts := v_conflicts || jsonb_build_object('table', 'household_services', 'id', v_id, 'server_version', v_cur_version);
        continue;
      end if;

      -- Rates are in the group currency; FOR SHARE orders this against a currency change.
      select g.currency into v_currency from public.groups g where g.id = v_group for share;
      if r->>'group_currency' is distinct from v_currency then
        v_rejected := v_rejected || jsonb_build_object('table', 'household_services', 'id', v_id, 'code', 'CURRENCY_MISMATCH');
        continue;
      end if;

      -- Posted bills must be expenses of this group.
      if exists (
        select 1 from jsonb_each(case when jsonb_typeof(r->'bills') = 'object' then r->'bills' else '{}'::jsonb end) b
        where not exists (
          select 1 from public.expenses e
          where e.id = (b.value #>> '{}')::uuid and e.group_id = v_group)
      ) then
        v_rejected := v_rejected || jsonb_build_object('table', 'household_services', 'id', v_id, 'code', 'INVALID', 'detail', 'BILL');
        continue;
      end if;

      if v_exists then
        update public.household_services
        set name = r->>'name',
            kind = r->>'kind',
            unit = r->>'unit',
            default_qty = (r->>'default_qty')::integer,
            rates = r->'rates',
            weekdays = (r->>'weekdays')::smallint,
            paid_leaves = (r->>'paid_leaves')::smallint,
            start_date = (r->>'start_date')::date,
            end_date = (r->>'end_date')::date,
            bills = coalesce(r->'bills', '{}'::jsonb),
            updated_at = (r->>'updated_at')::bigint,
            deleted_at = (r->>'deleted_at')::bigint
        where id = v_id
        returning version into v_version;
      else
        if not private.member_in_group((r->>'created_by_member_id')::uuid, v_group) then
          v_rejected := v_rejected || jsonb_build_object('table', 'household_services', 'id', v_id, 'code', 'UNKNOWN_MEMBER');
          continue;
        end if;
        insert into public.household_services (
          id, group_id, name, kind, unit, default_qty, rates, weekdays, paid_leaves, start_date,
          end_date, bills, created_by_member_id, created_at, updated_at, deleted_at)
        values (
          v_id, v_group, r->>'name', r->>'kind', r->>'unit', (r->>'default_qty')::integer, r->'rates',
          (r->>'weekdays')::smallint, (r->>'paid_leaves')::smallint, (r->>'start_date')::date,
          (r->>'end_date')::date, coalesce(r->'bills', '{}'::jsonb), (r->>'created_by_member_id')::uuid,
          (r->>'created_at')::bigint, (r->>'updated_at')::bigint, (r->>'deleted_at')::bigint)
        returning version into v_version;
      end if;

      v_applied := v_applied || jsonb_build_object('table', 'household_services', 'id', v_id, 'version', v_version);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object(
        'table', 'household_services', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
    end;
  end loop;

  for r in select value from jsonb_array_elements(
    case when jsonb_typeof(p_batch->'household_marks') = 'array' then p_batch->'household_marks' else '[]'::jsonb end)
  loop
    begin
      v_id := (r->>'id')::uuid;
      v_group := (r->>'group_id')::uuid;
      v_service := (r->>'service_id')::uuid;
      select x.group_id, x.service_id, x.version into v_cur_group, v_cur_service, v_cur_version
      from public.household_marks x where x.id = v_id for update;
      v_exists := found;

      if (v_exists and (v_cur_group <> v_group or v_cur_service <> v_service))
         or not private.is_active_member(p_user, v_group)
         or not exists (
           select 1 from public.household_services h
           where h.id = v_service and h.group_id = v_group and h.deleted_at is null)
      then
        v_rejected := v_rejected || jsonb_build_object('table', 'household_marks', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      end if;
      if (v_exists and v_cur_version is distinct from (r->>'base_version')::integer)
         or (not v_exists and coalesce((r->>'base_version')::integer, 0) <> 0) then
        v_conflicts := v_conflicts || jsonb_build_object('table', 'household_marks', 'id', v_id, 'server_version', v_cur_version);
        continue;
      end if;
      if not private.member_in_group((r->>'marked_by_member_id')::uuid, v_group) then
        v_rejected := v_rejected || jsonb_build_object('table', 'household_marks', 'id', v_id, 'code', 'UNKNOWN_MEMBER');
        continue;
      end if;

      if v_exists then
        update public.household_marks
        set qty = (r->>'qty')::integer,
            marked_by_member_id = (r->>'marked_by_member_id')::uuid,
            updated_at = (r->>'updated_at')::bigint
        where id = v_id
        returning version into v_version;
      else
        insert into public.household_marks (
          id, group_id, service_id, mark_date, qty, marked_by_member_id, created_at, updated_at)
        values (
          v_id, v_group, v_service, (r->>'mark_date')::date, (r->>'qty')::integer,
          (r->>'marked_by_member_id')::uuid, (r->>'created_at')::bigint, (r->>'updated_at')::bigint)
        returning version into v_version;
      end if;

      v_applied := v_applied || jsonb_build_object('table', 'household_marks', 'id', v_id, 'version', v_version);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object(
        'table', 'household_marks', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
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

notify pgrst, 'reload schema';
