-- Group budget smoke test. One transaction, rolled back: leaves no data.
begin;

insert into auth.users (id, email) values ('a8000000-0000-0000-0000-000000000001', 'asha.budget@test.local');

set local role service_role;

do $$
declare
  u constant uuid := 'a8000000-0000-0000-0000-000000000001';
  g constant text := '98100000-0000-0000-0000-000000000001';
  me constant text := 'b8000000-0000-0000-0000-000000000001';
  base jsonb;
  res jsonb;
  v integer;
begin
  base := jsonb_build_object('id', g, 'name', 'Goa', 'simplify_debts', true, 'currency', 'INR',
    'created_at', 1, 'updated_at', 1, 'deleted_at', null);

  -- ── 1. A budget arrives with the group ──
  res := public.apply_push(u, jsonb_build_object(
    'groups', jsonb_build_array(base || jsonb_build_object('budget_paise', 6000000, 'budget_period', 'total', 'base_version', 0)),
    'members', jsonb_build_array(jsonb_build_object('id', me, 'group_id', g, 'display_name', 'Asha', 'user_id', u,
      'upi_vpa', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0))));
  assert jsonb_array_length(res->'rejected') = 0, format('create: %s', res);
  assert (select row(budget_paise, budget_period)::text from public.groups where id = g::uuid) = '(6000000,total)', 'stored';

  -- ── 2. An older build (no keys) keeps it ──
  select version into v from public.groups where id = g::uuid;
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(
    base || jsonb_build_object('name', 'Goa 2026', 'updated_at', 2, 'base_version', v))));
  assert (select budget_paise from public.groups where id = g::uuid) = 6000000, 'old build keeps the budget';

  -- ── 3. Invalid values are refused, null clears ──
  select version into v from public.groups where id = g::uuid;
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(
    base || jsonb_build_object('budget_paise', 500, 'budget_period', 'weekly', 'updated_at', 3, 'base_version', v))));
  assert res->'rejected'->0->>'code' = 'INVALID', format('weekly must be refused: %s', res);
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(
    base || jsonb_build_object('budget_paise', null, 'budget_period', null, 'updated_at', 3, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('clear: %s', res);
  assert (select budget_paise is null and budget_period is null from public.groups where id = g::uuid), 'cleared';

  -- ── 4. A currency change clears it, even when the push sends one ──
  select version into v from public.groups where id = g::uuid;
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(
    base || jsonb_build_object('budget_paise', 1000000, 'budget_period', 'monthly', 'updated_at', 4, 'base_version', v))));
  select version into v from public.groups where id = g::uuid;
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(
    base || jsonb_build_object('currency', 'THB', 'budget_paise', 1000000, 'budget_period', 'monthly',
      'updated_at', 5, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('currency change: %s', res);
  assert (select currency = 'THB' and budget_paise is null from public.groups where id = g::uuid),
    'currency change must clear the budget';
end $$;

reset role;
rollback;

select 'Budget smoke test passed' as result;
