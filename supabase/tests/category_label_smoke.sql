-- Custom category label smoke test. One transaction, rolled back: leaves no data.
begin;

insert into auth.users (id, email) values ('a2000000-0000-0000-0000-000000000001', 'asha.cat@test.local');

set local role service_role;

do $$
declare
  res jsonb;
  expense constant jsonb := '{"id":"e2000000-0000-0000-0000-000000000001",
    "group_id":"92000000-0000-0000-0000-000000000001","description":"Fuel","amount_paise":50000,
    "category":"other","category_label":"Petrol","expense_date":"2026-10-01",
    "split_input":{"type":"equal","memberIds":["b2000000-0000-0000-0000-000000000001"]},
    "created_by_member_id":"b2000000-0000-0000-0000-000000000001",
    "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0,
    "payers":[{"member_id":"b2000000-0000-0000-0000-000000000001","amount_paise":50000}],
    "shares":[{"member_id":"b2000000-0000-0000-0000-000000000001","amount_paise":50000}]}';
  label text;
  v integer;
begin
  -- 1. Create: the label is stored.
  res := public.apply_push('a2000000-0000-0000-0000-000000000001', jsonb_build_object(
    'groups', '[{"id":"92000000-0000-0000-0000-000000000001","name":"Car","simplify_debts":true,
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}]'::jsonb,
    'members', '[{"id":"b2000000-0000-0000-0000-000000000001","group_id":"92000000-0000-0000-0000-000000000001",
      "display_name":"Asha","user_id":"a2000000-0000-0000-0000-000000000001","upi_vpa":null,
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}]'::jsonb,
    'expenses', jsonb_build_array(expense)));
  assert jsonb_array_length(res->'rejected') = 0, format('create rejected: %s', res);
  select category_label, version into label, v from public.expenses where id = 'e2000000-0000-0000-0000-000000000001';
  assert label = 'Petrol', format('label should be stored, got %s', label);

  -- 2. An old build pushes without the key: the label stays.
  res := public.apply_push('a2000000-0000-0000-0000-000000000001', jsonb_build_object('expenses', jsonb_build_array(
    (expense - 'category_label') || jsonb_build_object('description', 'Fuel (edited)', 'updated_at', 2, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('old-build update should apply: %s', res);
  select category_label, version into label, v from public.expenses where id = 'e2000000-0000-0000-0000-000000000001';
  assert label = 'Petrol', 'a push without category_label must keep the label';

  -- 3. Renamed, then cleared with null.
  res := public.apply_push('a2000000-0000-0000-0000-000000000001', jsonb_build_object('expenses', jsonb_build_array(
    expense || jsonb_build_object('category_label', 'Diesel', 'updated_at', 3, 'base_version', v))));
  select category_label, version into label, v from public.expenses where id = 'e2000000-0000-0000-0000-000000000001';
  assert label = 'Diesel', format('rename failed: %s', res);

  res := public.apply_push('a2000000-0000-0000-0000-000000000001', jsonb_build_object('expenses', jsonb_build_array(
    expense || jsonb_build_object('category_label', null, 'updated_at', 4, 'base_version', v))));
  select category_label, version into label, v from public.expenses where id = 'e2000000-0000-0000-0000-000000000001';
  assert label is null, 'an explicit null must clear the label';

  -- 4. A real category drops any label, even one sent along (and even from an old build).
  res := public.apply_push('a2000000-0000-0000-0000-000000000001', jsonb_build_object('expenses', jsonb_build_array(
    expense || jsonb_build_object('category', 'transport', 'category_label', 'Petrol', 'updated_at', 5, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('category change should apply: %s', res);
  select category_label, version into label, v from public.expenses where id = 'e2000000-0000-0000-0000-000000000001';
  assert label is null, 'a non-other category must not keep a label';

  -- 5. Too long / blank labels are rejected per row, nothing written.
  res := public.apply_push('a2000000-0000-0000-0000-000000000001', jsonb_build_object('expenses', jsonb_build_array(
    expense || jsonb_build_object('category_label', repeat('x', 31), 'updated_at', 6, 'base_version', v))));
  assert res->'rejected'->0->>'code' = 'INVALID', format('31 chars must be rejected: %s', res);
  res := public.apply_push('a2000000-0000-0000-0000-000000000001', jsonb_build_object('expenses', jsonb_build_array(
    expense || jsonb_build_object('category_label', '  ', 'updated_at', 6, 'base_version', v))));
  assert res->'rejected'->0->>'code' = 'INVALID', format('blank label must be rejected: %s', res);
  assert (select category from public.expenses where id = 'e2000000-0000-0000-0000-000000000001') = 'transport',
    'a rejected row must not change anything';

  -- 6. The setting doesn't leak to writes outside a push.
  perform set_config('app.push_category_labels', '', true);
end $$;

reset role;
rollback;

select 'Category label smoke test passed' as result;
