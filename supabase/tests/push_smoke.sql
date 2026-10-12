-- Push notifications smoke test. One transaction, rolled back: leaves no data.
begin;

insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000001', 'asha.push@test.local'),
  ('a9000000-0000-0000-0000-000000000002', 'rahul.push@test.local'),
  ('a9000000-0000-0000-0000-000000000003', 'outsider.push@test.local');

-- ── 1. Phones register (as their users) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.register_push_device('asha-token-0000000000000001', 'android', true, true, true, true);
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.register_push_device('rahul-token-000000000000001', 'android', true, true, true, false);
-- Rahul can't remove Asha's phone.
select public.unregister_push_device('asha-token-0000000000000001');

do $$
begin
  begin
    perform public.claim_push_notifications(10);
    assert false, 'members must not claim notifications';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.push_devices;
    assert false, 'members must not read devices';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_push_device('short', 'android', true, true, true, true);
    assert false, 'a malformed token must be refused';
  exception when check_violation then null;
  end;
end $$;

set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-0000000000ff","role":"authenticated"}';
do $$
begin
  perform public.register_push_device('x', 'android', true, true, true, true);
  assert false, 'unknown user';
exception when others then null; -- FK or check: anything but success
end $$;

reset role;
do $$
begin
  assert (select count(*) from public.push_devices where token like '%-token-%') = 2, 'both phones registered';
end $$;

-- The rest runs as the table owner: it also pokes the private outbox directly. The sender's
-- role must be able to call the functions it uses:
do $$
begin
  assert has_function_privilege('service_role', 'public.claim_push_notifications(integer)', 'execute')
     and has_function_privilege('service_role', 'public.drop_push_devices(text[])', 'execute')
     and has_function_privilege('service_role', 'public.push_fcm_credentials()', 'execute'), 'sender grants';
  assert not has_function_privilege('anon', 'public.push_fcm_credentials()', 'execute')
     and not has_function_privilege('authenticated', 'public.push_fcm_credentials()', 'execute'),
    'credentials stay server-side';
end $$;

do $$
declare
  asha_u constant uuid := 'a9000000-0000-0000-0000-000000000001';
  rahul_u constant uuid := 'a9000000-0000-0000-0000-000000000002';
  g constant text := '99000000-0000-0000-0000-000000000001';
  asha constant text := 'b9000000-0000-0000-0000-000000000001';
  rahul constant text := 'b9000000-0000-0000-0000-000000000002';
  priya constant text := 'b9000000-0000-0000-0000-000000000003';
  res jsonb;
  claim jsonb;
  entry jsonb;

begin
  res := public.apply_push(asha_u, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', g, 'name', 'Goa trip', 'simplify_debts', true,
      'currency', 'INR', 'budget_paise', 1000000, 'budget_period', 'total',
      'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(
      jsonb_build_object('id', asha, 'group_id', g, 'display_name', 'Asha', 'user_id', asha_u, 'upi_vpa', null,
        'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0),
      jsonb_build_object('id', rahul, 'group_id', g, 'display_name', 'Rahul', 'user_id', null, 'upi_vpa', null,
        'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0),
      jsonb_build_object('id', priya, 'group_id', g, 'display_name', 'Priya', 'user_id', null, 'upi_vpa', null,
        'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0))));
  assert jsonb_array_length(res->'rejected') = 0, format('setup: %s', res);
  -- Rahul joins (his placeholder gets his account).
  update public.members set user_id = rahul_u where id = rahul::uuid;
  delete from private.push_outbox;

  -- ── 2. Asha adds a ₹9,000 dinner (Asha 3,000 / Rahul 3,000 / Priya 3,000) ──
  res := public.apply_push(asha_u, jsonb_build_object(
    'expenses', jsonb_build_array(jsonb_build_object(
      'id', 'e9000000-0000-0000-0000-000000000001', 'group_id', g, 'description', 'Dinner', 'amount_paise', 900000,
      'category', 'food', 'expense_date', '2026-10-05',
      'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(asha, rahul, priya)),
      'created_by_member_id', asha, 'created_at', 2, 'updated_at', 2, 'deleted_at', null, 'base_version', 0,
      'group_currency', 'INR',
      'payers', jsonb_build_array(jsonb_build_object('member_id', asha, 'amount_paise', 900000)),
      'shares', jsonb_build_array(
        jsonb_build_object('member_id', asha, 'amount_paise', 300000),
        jsonb_build_object('member_id', rahul, 'amount_paise', 300000),
        jsonb_build_object('member_id', priya, 'amount_paise', 300000)))),
    'activity', jsonb_build_array(jsonb_build_object(
      'id', 'd9000000-0000-0000-0000-000000000001', 'group_id', g, 'entity_type', 'expense',
      'entity_id', 'e9000000-0000-0000-0000-000000000001', 'action', 'create', 'actor_member_id', asha,
      'before', null, 'after', jsonb_build_object('description', 'Dinner'), 'created_at', 2))));
  assert jsonb_array_length(res->'rejected') = 0, format('dinner: %s', res);
  assert (select count(*) from private.push_outbox) = 1, 'queued once';

  claim := public.claim_push_notifications(100);
  -- Rahul: the expense. Asha (who added it) gets only the budget alert (90% of ₹10,000).
  assert (select count(*) from private.push_outbox) = 0, 'claimed entries are removed';
  assert jsonb_array_length(claim) = 3, format('expected Rahul activity + two budget alerts: %s', claim);
  select value into entry from jsonb_array_elements(claim)
  where value->>'token' = 'rahul-token-000000000000001' and value->>'kind' = 'activity';
  assert entry->>'group_name' = 'Goa trip' and entry->>'currency' = 'INR'
     and (entry->>'indian_grouping')::boolean = false, format('entry: %s', entry);
  assert entry->'events'->0 @> jsonb_build_object('type', 'expense', 'description', 'Dinner', 'amount', 900000,
    'share', 300000, 'paid', 0, 'actor', 'Asha', 'recurring', false), format('event: %s', entry);
  assert not exists (select 1 from jsonb_array_elements(claim)
                     where value->>'token' = 'asha-token-0000000000000001' and value->>'kind' = 'activity'),
    'the person who added it is not told';
  select value into entry from jsonb_array_elements(claim)
  where value->>'token' = 'asha-token-0000000000000001' and value->>'kind' = 'budget';
  assert entry->'events'->0 @> '{"type":"budget","level":1,"limit":1000000,"spent":900000,"period":"total"}',
    format('budget: %s', entry);

  -- ── 3. Rahul records paying Asha ₹3,000: only Asha is told; the budget isn't repeated ──
  res := public.apply_push(rahul_u, jsonb_build_object(
    'settlements', jsonb_build_array(jsonb_build_object(
      'id', 'c9000000-0000-0000-0000-000000000001', 'group_id', g, 'from_member_id', rahul, 'to_member_id', asha,
      'amount_paise', 300000, 'method', 'upi', 'note', null, 'settled_at', 3, 'created_by_member_id', rahul,
      'created_at', 3, 'updated_at', 3, 'deleted_at', null, 'base_version', 0)),
    'activity', jsonb_build_array(jsonb_build_object(
      'id', 'd9000000-0000-0000-0000-000000000002', 'group_id', g, 'entity_type', 'settlement',
      'entity_id', 'c9000000-0000-0000-0000-000000000001', 'action', 'create', 'actor_member_id', rahul,
      'before', null, 'after', null, 'created_at', 3))));
  assert jsonb_array_length(res->'rejected') = 0, format('payment: %s', res);
  claim := public.claim_push_notifications(100);
  assert jsonb_array_length(claim) = 1, format('payment claim: %s', claim);
  assert claim->0->>'token' = 'asha-token-0000000000000001'
     and claim->0->'events'->0 @> '{"type":"payment","amount":300000,"from_name":"Rahul","to_name":"Asha","role":"to","actor":"Rahul"}',
    format('payment event: %s', claim);

  -- ── 4. Two more expenses by Asha: one entry for Rahul with both, budget goes "over" once ──
  res := public.apply_push(asha_u, jsonb_build_object(
    'expenses', (
      select jsonb_agg(jsonb_build_object(
        'id', id, 'group_id', g, 'description', d, 'amount_paise', 100000, 'category', 'transport',
        'expense_date', '2026-10-06',
        'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(asha, rahul)),
        'created_by_member_id', asha, 'created_at', 4, 'updated_at', 4, 'deleted_at', null, 'base_version', 0,
        'group_currency', 'INR',
        'payers', jsonb_build_array(jsonb_build_object('member_id', asha, 'amount_paise', 100000)),
        'shares', jsonb_build_array(
          jsonb_build_object('member_id', asha, 'amount_paise', 50000),
          jsonb_build_object('member_id', rahul, 'amount_paise', 50000))))
      from (values ('e9000000-0000-0000-0000-000000000002', 'Taxi'),
                   ('e9000000-0000-0000-0000-000000000003', 'Ferry')) v(id, d)),
    'activity', (
      select jsonb_agg(jsonb_build_object(
        'id', aid, 'group_id', g, 'entity_type', 'expense', 'entity_id', eid, 'action', 'create',
        'actor_member_id', asha, 'before', null, 'after', null, 'created_at', ts))
      from (values ('d9000000-0000-0000-0000-000000000003', 'e9000000-0000-0000-0000-000000000002', 4),
                   ('d9000000-0000-0000-0000-000000000004', 'e9000000-0000-0000-0000-000000000003', 5)) v(aid, eid, ts))));
  assert jsonb_array_length(res->'rejected') = 0, format('more: %s', res);
  claim := public.claim_push_notifications(100);
  select value into entry from jsonb_array_elements(claim)
  where value->>'token' = 'rahul-token-000000000000001' and value->>'kind' = 'activity';
  assert jsonb_array_length(entry->'events') = 2
     and entry->'events'->0->>'description' = 'Taxi' and entry->'events'->1->>'description' = 'Ferry',
    format('batched, in order: %s', entry);
  assert (select count(*) from jsonb_array_elements(claim)
          where value->>'kind' = 'budget' and value->'events'->0->>'level' = '2') = 2,
    format('over budget, both phones: %s', claim);

  -- ── 5. Preferences, deleted expenses, stale entries, groups without phones ──
  update public.push_devices set notify_expenses = false where token = 'rahul-token-000000000000001';
  insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, created_at)
  values ('d9000000-0000-0000-0000-000000000005', g::uuid, 'expense', 'e9000000-0000-0000-0000-000000000002',
          'create', asha::uuid, 6);
  claim := public.claim_push_notifications(100);
  assert claim = '[]'::jsonb, format('expenses turned off (and no new budget level): %s', claim);

  update public.push_devices set notify_expenses = true where token = 'rahul-token-000000000000001';
  update public.expenses set deleted_at = 9 where id = 'e9000000-0000-0000-0000-000000000003';
  insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, created_at)
  values ('d9000000-0000-0000-0000-000000000006', g::uuid, 'expense', 'e9000000-0000-0000-0000-000000000003',
          'create', asha::uuid, 7);
  assert public.claim_push_notifications(100) = '[]'::jsonb, 'deleted since: nothing to say';

  insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, created_at)
  values ('d9000000-0000-0000-0000-000000000007', g::uuid, 'expense', 'e9000000-0000-0000-0000-000000000002',
          'create', asha::uuid, 8);
  update private.push_outbox set created_at = now() - interval '2 hours';
  assert public.claim_push_notifications(100) = '[]'::jsonb, 'stale entries are dropped';
  assert (select count(*) from private.push_outbox) = 0, 'and removed';

  insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, created_at)
  values ('d9000000-0000-0000-0000-000000000008', g::uuid, 'expense', 'e9000000-0000-0000-0000-000000000002',
          'update', asha::uuid, 9);
  assert (select count(*) from private.push_outbox) = 0, 'edits are not queued';

  -- ── 6. Dead tokens are dropped; with no phones left, nothing is queued ──
  assert public.drop_push_devices(array['rahul-token-000000000000001', 'asha-token-0000000000000001']) = 2, 'dropped';
  insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, created_at)
  values ('d9000000-0000-0000-0000-000000000009', g::uuid, 'expense', 'e9000000-0000-0000-0000-000000000002',
          'create', asha::uuid, 10);
  assert (select count(*) from private.push_outbox) = 0, 'no phones, no queue';
  assert public.push_fcm_credentials() is null, 'no credentials in this database';
end $$;

reset role;
rollback;

select 'Push notifications smoke test passed' as result;
