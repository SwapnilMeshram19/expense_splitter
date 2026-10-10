-- Multi-currency smoke test. One transaction, rolled back: leaves no data.
begin;

insert into auth.users (id, email) values ('a3000000-0000-0000-0000-000000000001', 'asha.fx@test.local');

set local role service_role;

do $$
declare
  u constant uuid := 'a3000000-0000-0000-0000-000000000001';
  usd_group constant text := '93000000-0000-0000-0000-000000000001';
  inr_group constant text := '93000000-0000-0000-0000-000000000002';
  usd_me constant text := 'b3000000-0000-0000-0000-000000000001';
  inr_me constant text := 'b3000000-0000-0000-0000-000000000002';
  inr_rahul constant text := 'b3000000-0000-0000-0000-000000000003';
  res jsonb;
  page jsonb;
  row_ jsonb;
  v integer;
  plain jsonb;
  bill jsonb;
begin
  -- ── 1. A USD group with a plain USD expense ──
  plain := jsonb_build_object(
    'id', 'e3000000-0000-0000-0000-000000000001', 'group_id', usd_group, 'description', 'Taxi',
    'amount_paise', 2500, 'category', 'transport', 'expense_date', '2026-10-01',
    'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(usd_me)),
    'created_by_member_id', usd_me, 'created_at', 1, 'updated_at', 1, 'deleted_at', null,
    'base_version', 0, 'group_currency', 'USD',
    'original_currency', null, 'original_amount_minor', null, 'fx_rate', null,
    'payers', jsonb_build_array(jsonb_build_object('member_id', usd_me, 'amount_paise', 2500)),
    'shares', jsonb_build_array(jsonb_build_object('member_id', usd_me, 'amount_paise', 2500)));

  res := public.apply_push(u, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', usd_group, 'name', 'NYC', 'simplify_debts', true,
      'currency', 'USD', 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(jsonb_build_object('id', usd_me, 'group_id', usd_group, 'display_name', 'Asha',
      'user_id', u, 'upi_vpa', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'expenses', jsonb_build_array(plain)));
  assert jsonb_array_length(res->'rejected') = 0, format('USD group create rejected: %s', res);
  assert (select currency from public.groups where id = usd_group::uuid) = 'USD', 'group currency stored';

  -- ── 2. Currency is locked once there is an expense ──
  select version into v from public.groups where id = usd_group::uuid;
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(jsonb_build_object(
    'id', usd_group, 'name', 'NYC', 'simplify_debts', true, 'currency', 'EUR',
    'created_at', 1, 'updated_at', 2, 'deleted_at', null, 'base_version', v))));
  assert res->'rejected'->0->>'code' = 'CURRENCY_LOCKED', format('expected CURRENCY_LOCKED: %s', res);
  assert (select currency from public.groups where id = usd_group::uuid) = 'USD', 'currency must not change';

  -- An old build renaming the group (no currency key) keeps the currency.
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(jsonb_build_object(
    'id', usd_group, 'name', 'New York', 'simplify_debts', true,
    'created_at', 1, 'updated_at', 3, 'deleted_at', null, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('old-build rename should apply: %s', res);
  assert (select currency from public.groups where id = usd_group::uuid) = 'USD', 'rename keeps currency';

  -- ── 3. Rows asserting the wrong currency, and old builds, are refused in a USD group ──
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    plain || jsonb_build_object('id', 'e3000000-0000-0000-0000-000000000002', 'group_currency', 'INR'))));
  assert res->'rejected'->0->>'code' = 'CURRENCY_MISMATCH', format('expected CURRENCY_MISMATCH: %s', res);

  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    (plain - 'group_currency' - 'original_currency' - 'original_amount_minor' - 'fx_rate')
      || jsonb_build_object('id', 'e3000000-0000-0000-0000-000000000003'))));
  assert res->'rejected'->0->>'code' = 'UPGRADE_REQUIRED', format('old build in USD group: %s', res);

  -- ── 4. INR group with a USD bill: columns, payer originals, pull shape ──
  bill := jsonb_build_object(
    'id', 'e3000000-0000-0000-0000-000000000010', 'group_id', inr_group, 'description', 'Dinner in Dubai',
    'amount_paise', 289920, 'category', 'food', 'expense_date', '2026-10-01',
    'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(inr_me, inr_rahul)),
    'created_by_member_id', inr_me, 'created_at', 1, 'updated_at', 1, 'deleted_at', null,
    'base_version', 0, 'group_currency', 'INR',
    'original_currency', 'USD', 'original_amount_minor', 3000, 'fx_rate', '96.64',
    'payers', jsonb_build_array(
      jsonb_build_object('member_id', inr_me, 'amount_paise', 193280, 'original_amount_minor', 2000),
      jsonb_build_object('member_id', inr_rahul, 'amount_paise', 96640, 'original_amount_minor', 1000)),
    'shares', jsonb_build_array(
      jsonb_build_object('member_id', inr_me, 'amount_paise', 144960),
      jsonb_build_object('member_id', inr_rahul, 'amount_paise', 144960)));

  res := public.apply_push(u, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', inr_group, 'name', 'Dubai', 'simplify_debts', true,
      'currency', 'INR', 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(
      jsonb_build_object('id', inr_me, 'group_id', inr_group, 'display_name', 'Asha', 'user_id', u,
        'upi_vpa', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0),
      jsonb_build_object('id', inr_rahul, 'group_id', inr_group, 'display_name', 'Rahul', 'user_id', null,
        'upi_vpa', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'expenses', jsonb_build_array(bill)));
  assert jsonb_array_length(res->'rejected') = 0, format('foreign bill rejected: %s', res);
  assert (select row(original_currency, original_amount_minor, fx_rate)::text from public.expenses
          where id = 'e3000000-0000-0000-0000-000000000010') = '(USD,3000,96.64)', 'foreign columns stored';
  assert (select sum(original_amount_minor) from public.expense_payers
          where expense_id = 'e3000000-0000-0000-0000-000000000010') = 3000, 'payer originals stored';

  -- Pull as Asha: fx_rate is a string, payer lines carry originals, share lines don't.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  page := public.pull_page(null, array[inr_group::uuid], 300);
  select value into row_ from jsonb_array_elements(page->'expenses') where value->>'id' = 'e3000000-0000-0000-0000-000000000010';
  assert jsonb_typeof(row_->'fx_rate') = 'string' and row_->>'fx_rate' = '96.64', format('fx_rate: %s', row_);
  assert (row_->'payers'->0) ? 'original_amount_minor', format('payer original missing: %s', row_);
  assert not ((row_->'shares'->0) ? 'original_amount_minor'), 'shares must not carry originals';
  select value into row_ from jsonb_array_elements(page->'groups') where value->>'id' = inr_group;
  assert row_->>'currency' = 'INR', format('group currency in pull: %s', row_);
  reset role;
  set local role service_role;

  -- ── 5. Old builds may edit plain INR expenses but not foreign bills ──
  select version into v from public.expenses where id = 'e3000000-0000-0000-0000-000000000010';
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    (bill - 'group_currency' - 'original_currency' - 'original_amount_minor' - 'fx_rate')
      || jsonb_build_object('description', 'edited by old build', 'updated_at', 2, 'base_version', v))));
  assert res->'rejected'->0->>'code' = 'UPGRADE_REQUIRED', format('old build editing foreign bill: %s', res);
  assert (select description from public.expenses where id = 'e3000000-0000-0000-0000-000000000010') = 'Dinner in Dubai',
    'refused edit must not change the row';
  assert (select count(*) from public.expense_payers where expense_id = 'e3000000-0000-0000-0000-000000000010') = 2,
    'refused edit must keep the payer lines';

  -- New build switches the bill to plain INR: foreign columns and payer originals cleared.
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    bill || jsonb_build_object('original_currency', null, 'original_amount_minor', null, 'fx_rate', null,
      'payers', jsonb_build_array(jsonb_build_object('member_id', inr_me, 'amount_paise', 289920)),
      'updated_at', 3, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('switch to INR: %s', res);
  assert (select original_currency is null and fx_rate is null from public.expenses
          where id = 'e3000000-0000-0000-0000-000000000010'), 'foreign columns cleared';
  assert (select bool_and(original_amount_minor is null) from public.expense_payers
          where expense_id = 'e3000000-0000-0000-0000-000000000010'), 'payer originals cleared';

  -- Old build edits the now-plain INR expense: allowed, foreign columns stay null.
  select version into v from public.expenses where id = 'e3000000-0000-0000-0000-000000000010';
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    (bill - 'group_currency' - 'original_currency' - 'original_amount_minor' - 'fx_rate')
      || jsonb_build_object('payers', jsonb_build_array(jsonb_build_object('member_id', inr_me, 'amount_paise', 289920)),
                            'description', 'old build edit', 'updated_at', 4, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('old build on plain INR expense: %s', res);

  -- ── 6. Invalid foreign data is refused per row ──
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    bill || jsonb_build_object('id', 'e3000000-0000-0000-0000-000000000011', 'fx_rate', '96.640'))));
  assert res->'rejected'->0->>'code' = 'INVALID', format('non-canonical rate: %s', res);
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    bill || jsonb_build_object('id', 'e3000000-0000-0000-0000-000000000012', 'fx_rate', null))));
  assert res->'rejected'->0->>'code' = 'INVALID', format('bill without rate: %s', res);
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    bill || jsonb_build_object('id', 'e3000000-0000-0000-0000-000000000013', 'original_currency', 'INR'))));
  assert res->'rejected'->0->>'code' = 'INVALID', format('same-currency bill: %s', res);
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    bill || jsonb_build_object('id', 'e3000000-0000-0000-0000-000000000014', 'original_amount_minor', 2.5))));
  assert res->'rejected'->0->>'code' = 'INVALID', format('fractional original amount: %s', res);

  -- ── 7. Currency can change while a group has no money; settlements assert it ──
  res := public.apply_push(u, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', '93000000-0000-0000-0000-000000000003', 'name', 'Empty',
      'simplify_debts', true, 'currency', 'THB', 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(
      jsonb_build_object('id', 'b3000000-0000-0000-0000-000000000004', 'group_id', '93000000-0000-0000-0000-000000000003',
        'display_name', 'Asha', 'user_id', u, 'upi_vpa', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0),
      jsonb_build_object('id', 'b3000000-0000-0000-0000-000000000005', 'group_id', '93000000-0000-0000-0000-000000000003',
        'display_name', 'Mom', 'user_id', null, 'upi_vpa', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0))));
  assert jsonb_array_length(res->'rejected') = 0, format('THB group: %s', res);
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(jsonb_build_object(
    'id', '93000000-0000-0000-0000-000000000003', 'name', 'Empty', 'simplify_debts', true, 'currency', 'VND',
    'created_at', 1, 'updated_at', 2, 'deleted_at', null, 'base_version', 1))));
  assert jsonb_array_length(res->'applied') = 1, format('currency change without money: %s', res);
  assert (select currency from public.groups where id = '93000000-0000-0000-0000-000000000003') = 'VND', 'changed to VND';

  res := public.apply_push(u, jsonb_build_object('settlements', jsonb_build_array(jsonb_build_object(
    'id', 'c3000000-0000-0000-0000-000000000002', 'group_id', '93000000-0000-0000-0000-000000000003',
    'from_member_id', 'b3000000-0000-0000-0000-000000000005', 'to_member_id', 'b3000000-0000-0000-0000-000000000004',
    'amount_paise', 50000, 'method', 'cash', 'note', null, 'settled_at', 1,
    'created_by_member_id', 'b3000000-0000-0000-0000-000000000004', 'created_at', 1, 'updated_at', 1,
    'deleted_at', null, 'base_version', 0))));
  assert res->'rejected'->0->>'code' = 'UPGRADE_REQUIRED', format('old-build settlement in VND group: %s', res);
  res := public.apply_push(u, jsonb_build_object('settlements', jsonb_build_array(jsonb_build_object(
    'id', 'c3000000-0000-0000-0000-000000000002', 'group_id', '93000000-0000-0000-0000-000000000003',
    'from_member_id', 'b3000000-0000-0000-0000-000000000005', 'to_member_id', 'b3000000-0000-0000-0000-000000000004',
    'amount_paise', 50000, 'method', 'cash', 'note', null, 'settled_at', 1,
    'created_by_member_id', 'b3000000-0000-0000-0000-000000000004', 'created_at', 1, 'updated_at', 1,
    'deleted_at', null, 'base_version', 0, 'group_currency', 'VND'))));
  assert jsonb_array_length(res->'applied') = 1, format('VND settlement: %s', res);

  -- ── 8. Outside a push the triggers stay out of the way ──
  insert into public.expenses (id, group_id, description, amount_paise, expense_date, split_input,
                               created_by_member_id, created_at, updated_at)
  values ('e3000000-0000-0000-0000-000000000099', usd_group::uuid, 'direct', 100, '2026-10-01', '{"type":"equal"}',
          usd_me::uuid, 1, 1);
end $$;

-- ── 9. Rates: writer is service_role only, reader is public ──
do $$
declare
  n integer;
  rates jsonb;
begin
  n := public.fx_rates_upsert('[
    {"code":"USD","per_usd":"1","as_of":"2026-10-10","source":"frankfurter"},
    {"code":"INR","per_usd":"96.64","as_of":"2026-10-10","source":"frankfurter"},
    {"code":"MVR","per_usd":"15.42","as_of":"2026-10-10","source":"exchangerate-api"},
    {"code":"BAD","per_usd":"-1","as_of":"2026-10-10","source":"frankfurter"},
    {"code":"EUR","per_usd":"0.92","as_of":"2026-10-10","source":"somewhere"}
  ]'::jsonb);
  assert n = 3, format('3 valid rows expected, got %s', n);
  -- An older date never replaces a newer one.
  perform public.fx_rates_upsert('[{"code":"INR","per_usd":"90","as_of":"2026-10-01","source":"exchangerate-api"}]'::jsonb);
  rates := public.fx_rates();
  assert rates->'rates'->'INR'->>0 = '96.64', format('stale rate must not win: %s', rates);
end $$;

reset role;
set local role anon;
do $$
begin
  assert (public.fx_rates()->'rates') ? 'MVR', 'anon must read rates';
  begin
    perform public.fx_rates_upsert('[]'::jsonb);
    assert false, 'anon must not write rates';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from private.fx_rates;
    assert false, 'anon must not read the table directly';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;

select 'Multi-currency smoke test passed' as result;
