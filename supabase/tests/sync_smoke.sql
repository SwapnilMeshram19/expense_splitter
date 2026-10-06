-- apply_push + pull_changes smoke test. One transaction, rolled back: leaves no data.
-- Run: source ~/.supabase-dev.env && psql -v ON_ERROR_STOP=1 -f supabase/tests/sync_smoke.sql
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'asha@test.local'),
  ('a0000000-0000-0000-0000-000000000002', 'bala@test.local');

set local role service_role;

-- 1. Asha creates a group with herself, a placeholder, an expense and its history entry.
do $$
declare res jsonb;
begin
  res := public.apply_push('a0000000-0000-0000-0000-000000000001', '{
    "groups": [{"id":"90000000-0000-0000-0000-000000000001","name":"Goa","simplify_debts":true,
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}],
    "members": [
      {"id":"b0000000-0000-0000-0000-000000000001","group_id":"90000000-0000-0000-0000-000000000001",
       "display_name":"Asha","user_id":"a0000000-0000-0000-0000-000000000001","upi_vpa":null,
       "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0},
      {"id":"b0000000-0000-0000-0000-000000000003","group_id":"90000000-0000-0000-0000-000000000001",
       "display_name":"Mom","user_id":null,"upi_vpa":null,
       "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}],
    "expenses": [{"id":"e0000000-0000-0000-0000-000000000001","group_id":"90000000-0000-0000-0000-000000000001",
      "description":"Dinner","amount_paise":90000,"category":"food","expense_date":"2026-10-01",
      "split_input":{"type":"equal","memberIds":["b0000000-0000-0000-0000-000000000001","b0000000-0000-0000-0000-000000000003"]},
      "created_by_member_id":"b0000000-0000-0000-0000-000000000001",
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0,
      "payers":[{"member_id":"b0000000-0000-0000-0000-000000000001","amount_paise":90000}],
      "shares":[{"member_id":"b0000000-0000-0000-0000-000000000001","amount_paise":45000},
                {"member_id":"b0000000-0000-0000-0000-000000000003","amount_paise":45000}]}],
    "activity": [{"id":"d0000000-0000-0000-0000-000000000001","group_id":"90000000-0000-0000-0000-000000000001",
      "entity_type":"expense","entity_id":"e0000000-0000-0000-0000-000000000001","action":"create",
      "actor_member_id":"b0000000-0000-0000-0000-000000000001","before":null,"after":{"description":"Dinner"},
      "created_at":1}]
  }'::jsonb);

  assert jsonb_array_length(res->'applied') = 5, format('create: expected 5 applied, got %s', res);
  assert jsonb_array_length(res->'rejected') = 0 and jsonb_array_length(res->'conflicts') = 0,
    format('create: nothing should be rejected or conflict: %s', res);
  assert (select version from public.expenses where id = 'e0000000-0000-0000-0000-000000000001') = 1,
    'new rows start at version 1';
end $$;

-- 2. Update with the right base version applies; a stale base version conflicts and changes nothing.
do $$
declare
  res jsonb;
  updated jsonb := '{"expenses": [{"id":"e0000000-0000-0000-0000-000000000001",
    "group_id":"90000000-0000-0000-0000-000000000001","description":"Dinner","amount_paise":120000,
    "category":"food","expense_date":"2026-10-01",
    "split_input":{"type":"equal","memberIds":["b0000000-0000-0000-0000-000000000001","b0000000-0000-0000-0000-000000000003"]},
    "created_by_member_id":"b0000000-0000-0000-0000-000000000001",
    "created_at":1,"updated_at":2,"deleted_at":null,"base_version":1,
    "payers":[{"member_id":"b0000000-0000-0000-0000-000000000001","amount_paise":120000}],
    "shares":[{"member_id":"b0000000-0000-0000-0000-000000000001","amount_paise":60000},
              {"member_id":"b0000000-0000-0000-0000-000000000003","amount_paise":60000}]}]}';
begin
  res := public.apply_push('a0000000-0000-0000-0000-000000000001', updated);
  assert res->'applied'->0->>'version' = '2', format('update: expected version 2: %s', res);
  assert (select sum(amount_paise) from public.expense_shares
          where expense_id = 'e0000000-0000-0000-0000-000000000001') = 120000, 'share lines must be rewritten';

  res := public.apply_push('a0000000-0000-0000-0000-000000000001',
    jsonb_set(updated, '{expenses,0,amount_paise}', '150000'));
  assert res->'conflicts'->0->>'server_version' = '2', format('stale base must conflict: %s', res);
  assert (select amount_paise from public.expenses where id = 'e0000000-0000-0000-0000-000000000001') = 120000,
    'a conflict must not overwrite';
end $$;

-- 3. Bala (not a member) tries to touch Asha's data.
do $$
declare res jsonb;
begin
  res := public.apply_push('a0000000-0000-0000-0000-000000000002',
    '{"groups":[{"id":"90000000-0000-0000-0000-000000000001","name":"Hacked","simplify_debts":true,
      "created_at":1,"updated_at":9,"deleted_at":null,"base_version":1}]}');
  assert res->'rejected'->0->>'code' = 'FORBIDDEN', format('non-member update: %s', res);
  assert (select name from public.groups where id = '90000000-0000-0000-0000-000000000001') = 'Goa',
    'group must be unchanged';

  -- A new group whose only member is linked to someone else is refused, member row included.
  res := public.apply_push('a0000000-0000-0000-0000-000000000002', '{
    "groups":[{"id":"90000000-0000-0000-0000-000000000009","name":"Fake","simplify_debts":true,
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}],
    "members":[{"id":"b0000000-0000-0000-0000-000000000009","group_id":"90000000-0000-0000-0000-000000000009",
      "display_name":"Asha","user_id":"a0000000-0000-0000-0000-000000000001","upi_vpa":null,
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}]}');
  assert jsonb_array_length(res->'rejected') = 2 and jsonb_array_length(res->'applied') = 0,
    format('fake group must be refused: %s', res);
  assert not exists (select 1 from public.groups where id = '90000000-0000-0000-0000-000000000009'),
    'fake group must not exist';

  -- Bala's own group works.
  res := public.apply_push('a0000000-0000-0000-0000-000000000002', '{
    "groups":[{"id":"90000000-0000-0000-0000-000000000002","name":"Flat","simplify_debts":true,
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}],
    "members":[{"id":"b0000000-0000-0000-0000-000000000002","group_id":"90000000-0000-0000-0000-000000000002",
      "display_name":"Bala","user_id":"a0000000-0000-0000-0000-000000000002","upi_vpa":null,
      "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}]}');
  assert jsonb_array_length(res->'applied') = 2, format('own group: %s', res);

  -- Reusing Asha's expense id inside his own group: FORBIDDEN, never moved.
  res := public.apply_push('a0000000-0000-0000-0000-000000000002', '{"expenses":[{
    "id":"e0000000-0000-0000-0000-000000000001","group_id":"90000000-0000-0000-0000-000000000002",
    "description":"Steal","amount_paise":100,"category":"general","expense_date":"2026-10-01",
    "split_input":{"type":"equal","memberIds":["b0000000-0000-0000-0000-000000000002"]},
    "created_by_member_id":"b0000000-0000-0000-0000-000000000002",
    "created_at":1,"updated_at":1,"deleted_at":null,"base_version":2,
    "payers":[{"member_id":"b0000000-0000-0000-0000-000000000002","amount_paise":100}],
    "shares":[{"member_id":"b0000000-0000-0000-0000-000000000002","amount_paise":100}]}]}');
  assert res->'rejected'->0->>'code' = 'FORBIDDEN', format('id collision: %s', res);
  assert (select group_id from public.expenses where id = 'e0000000-0000-0000-0000-000000000001')
         = '90000000-0000-0000-0000-000000000001', 'expense must stay in Goa';

  -- An expense in his group paid by a member of Asha's group: UNKNOWN_MEMBER.
  res := public.apply_push('a0000000-0000-0000-0000-000000000002', '{"expenses":[{
    "id":"e0000000-0000-0000-0000-000000000002","group_id":"90000000-0000-0000-0000-000000000002",
    "description":"Rent","amount_paise":100,"category":"general","expense_date":"2026-10-01",
    "split_input":{"type":"equal","memberIds":["b0000000-0000-0000-0000-000000000002"]},
    "created_by_member_id":"b0000000-0000-0000-0000-000000000002",
    "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0,
    "payers":[{"member_id":"b0000000-0000-0000-0000-000000000001","amount_paise":100}],
    "shares":[{"member_id":"b0000000-0000-0000-0000-000000000002","amount_paise":100}]}]}');
  assert res->'rejected'->0->>'code' = 'UNKNOWN_MEMBER', format('cross-group member: %s', res);
end $$;

-- 4. Asha: identity rules, idempotent history, per-row isolation of invalid rows.
do $$
declare
  res jsonb;
  s1 jsonb := '{"id":"5e000000-0000-0000-0000-000000000001","group_id":"90000000-0000-0000-0000-000000000001",
    "from_member_id":"b0000000-0000-0000-0000-000000000003","to_member_id":"b0000000-0000-0000-0000-000000000001",
    "amount_paise":30000,"method":"upi","note":null,"settled_at":3,
    "created_by_member_id":"b0000000-0000-0000-0000-000000000001",
    "created_at":3,"updated_at":3,"deleted_at":null,"base_version":0}';
begin
  res := public.apply_push('a0000000-0000-0000-0000-000000000001', '{"members":[{
    "id":"b0000000-0000-0000-0000-000000000004","group_id":"90000000-0000-0000-0000-000000000001",
    "display_name":"Bala","user_id":"a0000000-0000-0000-0000-000000000002","upi_vpa":null,
    "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}]}');
  assert res->'rejected'->0->>'code' = 'USER_ID_NOT_ALLOWED', format('linking another account: %s', res);

  res := public.apply_push('a0000000-0000-0000-0000-000000000001', '{"members":[{
    "id":"b0000000-0000-0000-0000-000000000003","group_id":"90000000-0000-0000-0000-000000000001",
    "display_name":"Mom","user_id":"a0000000-0000-0000-0000-000000000001","upi_vpa":null,
    "created_at":1,"updated_at":4,"deleted_at":null,"base_version":1}]}');
  assert res->'rejected'->0->>'code' = 'USER_ID_IMMUTABLE', format('claiming via push: %s', res);

  res := public.apply_push('a0000000-0000-0000-0000-000000000001', '{"activity":[{
    "id":"d0000000-0000-0000-0000-000000000001","group_id":"90000000-0000-0000-0000-000000000001",
    "entity_type":"expense","entity_id":"e0000000-0000-0000-0000-000000000001","action":"create",
    "actor_member_id":"b0000000-0000-0000-0000-000000000001","before":null,"after":null,"created_at":1}]}');
  assert jsonb_array_length(res->'applied') = 1, format('retried history must be acknowledged: %s', res);
  assert (select count(*) from public.activity_log where id = 'd0000000-0000-0000-0000-000000000001') = 1, 'retried history must not duplicate';

  res := public.apply_push('a0000000-0000-0000-0000-000000000001', jsonb_build_object('settlements',
    jsonb_build_array(
      s1,
      jsonb_set(jsonb_set(s1, '{id}', '"5e000000-0000-0000-0000-000000000002"'), '{note}', to_jsonb(repeat('x', 600)))
    )));
  assert jsonb_array_length(res->'applied') = 1, format('valid settlement must apply: %s', res);
  assert res->'rejected'->0->>'code' = 'INVALID' and res->'rejected'->0->>'detail' = '23514',
    format('invalid settlement must be rejected alone: %s', res);
end $$;

-- 5. Pull as Asha.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare res jsonb;
begin
  -- Rows written by a transaction that is still open are never returned incrementally:
  -- this is what makes the cursor safe against concurrent pushes.
  res := public.pull_changes(null);
  assert res->>'cursor' is not null, 'cursor must be returned';
  assert not (res->'groups' @> '[{"id":"90000000-0000-0000-0000-000000000001"}]'),
    'uncommitted rows must not appear in an incremental pull';

  res := public.pull_changes(null, array['90000000-0000-0000-0000-000000000001']::uuid[]);
  assert res->'group_ids' = '["90000000-0000-0000-0000-000000000001"]', format('group_ids: %s', res->'group_ids');
  assert jsonb_array_length(res->'groups') = 1, 'full fetch: 1 group';
  assert jsonb_array_length(res->'members') = 2, 'full fetch: 2 members';
  assert jsonb_array_length(res->'expenses') = 1, 'full fetch: 1 expense';
  assert jsonb_array_length(res->'expenses'->0->'shares') = 2, 'expense carries its share lines';
  assert jsonb_array_length(res->'settlements') = 1, 'full fetch: 1 settlement';
  assert jsonb_array_length(res->'activity') = 1, 'full fetch: 1 activity entry';
  assert not (res->'groups'->0 ? 'change_xid'), 'internal columns must not be exposed';

  begin
    perform public.apply_push('a0000000-0000-0000-0000-000000000001', '{}'::jsonb);
    raise exception 'FAIL: authenticated can call apply_push directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 6. Pull as Bala: Asha's group is invisible even when asked for by id.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare res jsonb;
begin
  res := public.pull_changes(null, array['90000000-0000-0000-0000-000000000001']::uuid[]);
  assert jsonb_array_length(res->'groups') = 0 and jsonb_array_length(res->'members') = 0,
    format('RLS must hide other groups: %s', res);
  assert res->'group_ids' = '["90000000-0000-0000-0000-000000000002"]', format('Bala group_ids: %s', res->'group_ids');
end $$;

-- 7. Anonymous: no sync at all.
reset role;
set local role anon;
do $$
begin
  begin
    perform public.pull_changes(null);
    raise exception 'FAIL: anon can pull';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;

select 'sync smoke test passed' as result;