-- Server-first API smoke test: snapshots, history paging, all-or-nothing commands, idempotent
-- retries, per-rule generation, anonymous merge and clean-up.
-- One transaction, rolled back: leaves no data.
-- Run: source ~/.supabase-dev.env && psql -v ON_ERROR_STOP=1 -f supabase/tests/server_first_smoke.sql
begin;

insert into auth.users (id, email, is_anonymous) values
  ('a9000000-0000-0000-0000-000000000001', 'asha.sf@test.local', false),
  ('a9000000-0000-0000-0000-000000000002', null, true),
  ('a9000000-0000-0000-0000-000000000003', 'bala.sf@test.local', false);

set local role service_role;

-- 1. A command applies as a whole and reports versions.
do $$
declare res jsonb;
begin
  res := public.api_apply('a9000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000001',
    'group.create', '99000000-0000-0000-0000-000000000001', '{
    "groups": [{"id":"99000000-0000-0000-0000-000000000001","name":"Goa","simplify_debts":true,"currency":"INR",
      "budget_paise":null,"budget_period":null,"created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}],
    "members": [
      {"id":"b9000000-0000-0000-0000-000000000001","group_id":"99000000-0000-0000-0000-000000000001",
       "display_name":"Asha","user_id":"a9000000-0000-0000-0000-000000000001","upi_vpa":null,"pay_methods":null,
       "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0},
      {"id":"b9000000-0000-0000-0000-000000000002","group_id":"99000000-0000-0000-0000-000000000001",
       "display_name":"Mom","user_id":null,"upi_vpa":null,"pay_methods":null,
       "created_at":1,"updated_at":1,"deleted_at":null,"base_version":0}],
    "activity": [{"id":"d9000000-0000-0000-0000-000000000001","group_id":"99000000-0000-0000-0000-000000000001",
      "entity_type":"group","entity_id":"99000000-0000-0000-0000-000000000001","action":"create",
      "actor_member_id":"b9000000-0000-0000-0000-000000000001","before":null,"after":{"name":"Goa"},"created_at":1}]
  }'::jsonb);
  assert (res->>'ok')::boolean, format('create: %s', res);
  assert (res->'versions'->>'groups:99000000-0000-0000-0000-000000000001')::int = 1, format('versions: %s', res);
  assert res->>'rev' is not null, 'rev returned';

  -- Same request id again: the stored answer, nothing applied twice.
  assert public.api_apply('a9000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000001',
    'group.create', '99000000-0000-0000-0000-000000000001', '{}'::jsonb) = res, 'retry returns the first answer';
  assert public.api_request_result('a9000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000001') = res,
    'answer stored';
end $$;

-- 2. An expense; then a stale edit is refused and leaves no trace (not even its history entry).
do $$
declare res jsonb; n int;
begin
  res := public.api_apply('a9000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000002',
    'expense.add', '99000000-0000-0000-0000-000000000001', '{
    "expenses": [{"id":"e9000000-0000-0000-0000-000000000001","group_id":"99000000-0000-0000-0000-000000000001",
      "description":"Dinner","amount_paise":90000,"category":"food","category_label":null,"expense_date":"2026-10-01",
      "split_input":{"type":"equal","memberIds":["b9000000-0000-0000-0000-000000000001","b9000000-0000-0000-0000-000000000002"]},
      "created_by_member_id":"b9000000-0000-0000-0000-000000000001","original_currency":null,"original_amount_minor":null,
      "fx_rate":null,"note":null,"receipt_id":null,"recurring_rule_id":null,"occurrence_date":null,
      "created_at":2,"updated_at":2,"deleted_at":null,"group_currency":"INR","base_version":0,
      "payers":[{"member_id":"b9000000-0000-0000-0000-000000000001","amount_paise":90000}],
      "shares":[{"member_id":"b9000000-0000-0000-0000-000000000001","amount_paise":45000},
                {"member_id":"b9000000-0000-0000-0000-000000000002","amount_paise":45000}]}],
    "activity": [{"id":"d9000000-0000-0000-0000-000000000002","group_id":"99000000-0000-0000-0000-000000000001",
      "entity_type":"expense","entity_id":"e9000000-0000-0000-0000-000000000001","action":"create",
      "actor_member_id":"b9000000-0000-0000-0000-000000000001","before":null,"after":{"description":"Dinner"},"created_at":2}]
  }'::jsonb);
  assert (res->>'ok')::boolean, format('expense: %s', res);

  res := public.api_apply('a9000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000003',
    'expense.update', '99000000-0000-0000-0000-000000000001', '{
    "expenses": [{"id":"e9000000-0000-0000-0000-000000000001","group_id":"99000000-0000-0000-0000-000000000001",
      "description":"Stale","amount_paise":90000,"category":"food","expense_date":"2026-10-01",
      "split_input":{"type":"equal","memberIds":["b9000000-0000-0000-0000-000000000001"]},
      "created_by_member_id":"b9000000-0000-0000-0000-000000000001",
      "created_at":2,"updated_at":3,"deleted_at":null,"group_currency":"INR","base_version":0,
      "payers":[{"member_id":"b9000000-0000-0000-0000-000000000001","amount_paise":90000}],
      "shares":[{"member_id":"b9000000-0000-0000-0000-000000000001","amount_paise":90000}]}],
    "activity": [{"id":"d9000000-0000-0000-0000-000000000003","group_id":"99000000-0000-0000-0000-000000000001",
      "entity_type":"expense","entity_id":"e9000000-0000-0000-0000-000000000001","action":"update",
      "actor_member_id":"b9000000-0000-0000-0000-000000000001","before":null,"after":{"description":"Stale"},"created_at":3}]
  }'::jsonb);
  assert res = '{"ok": false, "error": {"code": "STALE"}}'::jsonb, format('stale: %s', res);
  assert (select description from public.expenses where id = 'e9000000-0000-0000-0000-000000000001') = 'Dinner',
    'stale edit not applied';
  select count(*) into n from public.activity_log where id = 'd9000000-0000-0000-0000-000000000003';
  assert n = 0, 'history of a refused command is rolled back too';
end $$;

-- 3. Removing a member who still owes is refused as a whole.
do $$
declare res jsonb;
begin
  res := public.api_apply('a9000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000004',
    'member.remove', '99000000-0000-0000-0000-000000000001', '{
    "members": [{"id":"b9000000-0000-0000-0000-000000000002","group_id":"99000000-0000-0000-0000-000000000001",
       "display_name":"Mom","user_id":null,"upi_vpa":null,"pay_methods":null,
       "created_at":1,"updated_at":4,"deleted_at":4,"base_version":1}]
  }'::jsonb);
  assert res->'error'->>'code' = 'MEMBER_HAS_BALANCE', format('guard: %s', res);
  assert (select deleted_at from public.members where id = 'b9000000-0000-0000-0000-000000000002') is null, 'still a member';
end $$;

-- 4. api_group_state: members get the snapshot, others only learn whether the id is taken.
do $$
declare st jsonb;
begin
  st := public.api_group_state('a9000000-0000-0000-0000-000000000001', '99000000-0000-0000-0000-000000000001');
  assert (st->>'exists')::boolean and st->'snapshot'->'group'->>'name' = 'Goa', format('member state: %s', st);
  assert jsonb_array_length(st->'snapshot'->'expenses') = 1 and (st->'snapshot'->>'currency_locked')::boolean, 'expense + lock';
  st := public.api_group_state('a9000000-0000-0000-0000-000000000003', '99000000-0000-0000-0000-000000000001');
  assert (st->>'exists')::boolean and st->'snapshot' = 'null'::jsonb, format('outsider state: %s', st);
end $$;

-- 5. A rule saved through api_apply creates its due expenses at once.
do $$
declare res jsonb; n int;
begin
  res := public.api_apply('a9000000-0000-0000-0000-000000000001', '00000000-0000-4000-8000-000000000005',
    'recurring.create', '99000000-0000-0000-0000-000000000001', jsonb_build_object('recurring_rules', jsonb_build_array(
      jsonb_build_object('id','f9000000-0000-0000-0000-000000000001','group_id','99000000-0000-0000-0000-000000000001',
        'description','Rent','amount_paise',200000,'category','stay','category_label',null,'note',null,
        'split_input','{"type":"equal","memberIds":["b9000000-0000-0000-0000-000000000001","b9000000-0000-0000-0000-000000000002"]}'::jsonb,
        'payers','[{"member_id":"b9000000-0000-0000-0000-000000000001","amount_paise":200000}]'::jsonb,
        'shares','[{"member_id":"b9000000-0000-0000-0000-000000000001","amount_paise":100000},{"member_id":"b9000000-0000-0000-0000-000000000002","amount_paise":100000}]'::jsonb,
        'frequency','monthly','start_date', to_char(now() - interval '40 days', 'YYYY-MM-DD'),'end_date',null,
        'time_zone','Asia/Kolkata','created_by_member_id','b9000000-0000-0000-0000-000000000001',
        'created_at',5,'updated_at',5,'deleted_at',null,'group_currency','INR','base_version',0))),
    'f9000000-0000-0000-0000-000000000001');
  assert (res->>'ok')::boolean, format('rule: %s', res);
  select count(*) into n from public.expenses where recurring_rule_id = 'f9000000-0000-0000-0000-000000000001';
  assert n = 2, format('expected 2 due occurrences, got %s', n);
end $$;

-- 6. Reads, as the signed-in user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare res jsonb; rev text;
begin
  res := public.get_group('99000000-0000-0000-0000-000000000001');
  assert res->>'status' = 'OK' and jsonb_array_length(res->'snapshot'->'expenses') = 3, format('get_group: %s', res);
  assert res->'snapshot'->'rules_with_occurrences' = '["f9000000-0000-0000-0000-000000000001"]'::jsonb, 'rules with occurrences';
  rev := res->'snapshot'->>'rev';
  assert public.get_group('99000000-0000-0000-0000-000000000001', rev)->>'status' = 'UNCHANGED', 'same rev: unchanged';

  res := public.list_groups(jsonb_build_object('99000000-0000-0000-0000-000000000001', rev));
  assert jsonb_array_length(res->'groups') = 1 and not (res->'groups'->0 ? 'snapshot'), format('list known: %s', res);
  res := public.list_groups();
  assert res->'groups'->0 ? 'snapshot', 'list unknown: full snapshot';

  res := public.list_activity(null, null, null, 2);
  assert jsonb_array_length(res->'activity') = 2 and (res->>'more')::boolean, format('page 1: %s', res);
  res := public.list_activity(null, (res->'activity'->1->>'created_at')::bigint, (res->'activity'->1->>'id')::uuid, 50);
  assert jsonb_array_length(res->'activity') = 2 and not (res->>'more')::boolean, format('page 2: %s', res);
end $$;

set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  assert public.get_group('99000000-0000-0000-0000-000000000001')->>'status' = 'FORBIDDEN', 'outsider: forbidden';
  assert public.get_group('99000000-0000-0000-0000-0000000000ff')->>'status' = 'FORBIDDEN', 'missing: same answer';
  assert public.list_activity('99000000-0000-0000-0000-000000000001')->>'status' = 'FORBIDDEN', 'outsider history';
  assert jsonb_array_length(public.list_groups()->'groups') = 0, 'outsider sees no groups';
end $$;

-- 7. Anonymous user with their own group, then merged into Bala's saved account.
reset role;
insert into public.groups (id, name, created_at, updated_at) values ('99000000-0000-0000-0000-000000000002', 'Flat', 1, 1);
insert into public.members (id, group_id, display_name, user_id, created_at, updated_at) values
  ('b9000000-0000-0000-0000-000000000009', '99000000-0000-0000-0000-000000000002', 'Me', 'a9000000-0000-0000-0000-000000000002', 1, 1);
set local role service_role;
do $$
declare res jsonb;
begin
  assert public.merge_anonymous_user('a9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000003')->>'status'
    = 'NOT_ANONYMOUS', 'only anonymous users can be merged';
  res := public.merge_anonymous_user('a9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000003');
  assert res->>'status' = 'OK' and res->'moved' = '["99000000-0000-0000-0000-000000000002"]'::jsonb, format('merge: %s', res);
  assert (select user_id from public.members where id = 'b9000000-0000-0000-0000-000000000009')
    = 'a9000000-0000-0000-0000-000000000003', 'member moved to the saved account';
end $$;

-- 8. Clean-up removes only old anonymous users without groups.
reset role;
insert into auth.users (id, is_anonymous, created_at) values
  ('a9000000-0000-0000-0000-000000000004', true, now() - interval '40 days'),
  ('a9000000-0000-0000-0000-000000000005', true, now() - interval '2 days');
do $$
begin
  perform private.cleanup_anonymous_users();
  assert not exists (select 1 from auth.users where id = 'a9000000-0000-0000-0000-000000000004'), 'old anonymous user deleted';
  assert exists (select 1 from auth.users where id = 'a9000000-0000-0000-0000-000000000005'), 'recent one kept';
  assert exists (select 1 from auth.users where id = 'a9000000-0000-0000-0000-000000000002'), 'recent anonymous user kept';
end $$;

rollback;
