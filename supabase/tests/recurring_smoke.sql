-- Recurring expenses smoke test. One transaction, rolled back: leaves no data.
begin;

insert into auth.users (id, email) values ('a6000000-0000-0000-0000-000000000001', 'asha.recurring@test.local');

set local role service_role;

do $$
declare
  u constant uuid := 'a6000000-0000-0000-0000-000000000001';
  g constant text := '95000000-0000-0000-0000-000000000001';
  me constant text := 'b6000000-0000-0000-0000-000000000001';
  rahul constant text := 'b6000000-0000-0000-0000-000000000002';
  rule_id constant text := '96000000-0000-0000-0000-000000000001';
  -- Computed by the app (src/domain/recurrence.ts occurrenceId / occurrenceActivityId).
  oct_id constant uuid := 'e4e177ea-5280-5b84-b36a-896f093bcba1';
  nov_id constant uuid := 'fdc0737f-20ee-5830-82d3-e9114c45dc28';
  dec_id constant uuid := '9f76e2b3-55ad-5136-9106-95ebaa234292';
  oct_activity constant uuid := 'dceb9dcd-e014-5f87-884a-e25ff2f53de0';
  rule jsonb;
  res jsonb;
  n integer;
  v integer;
begin
  rule := jsonb_build_object(
    'id', rule_id, 'group_id', g, 'description', 'Rent', 'amount_paise', 3000000, 'category', 'stay',
    'category_label', null, 'note', null,
    'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(me, rahul)),
    'payers', jsonb_build_array(jsonb_build_object('member_id', me, 'amount_paise', 3000000)),
    'shares', jsonb_build_array(
      jsonb_build_object('member_id', me, 'amount_paise', 1500000),
      jsonb_build_object('member_id', rahul, 'amount_paise', 1500000)),
    'frequency', 'monthly', 'start_date', '2026-10-01', 'end_date', null, 'time_zone', 'Asia/Kolkata',
    'created_by_member_id', me, 'created_at', 1, 'updated_at', 1, 'deleted_at', null,
    'base_version', 0, 'group_currency', 'INR');

  -- ── 1. A rule arrives with its group and members in one push ──
  res := public.apply_push(u, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', g, 'name', 'Flat 302', 'simplify_debts', true,
      'currency', 'INR', 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(
      jsonb_build_object('id', me, 'group_id', g, 'display_name', 'Asha', 'user_id', u, 'upi_vpa', null,
        'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0),
      jsonb_build_object('id', rahul, 'group_id', g, 'display_name', 'Rahul', 'user_id', null, 'upi_vpa', null,
        'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'recurring_rules', jsonb_build_array(rule)));
  assert jsonb_array_length(res->'rejected') = 0 and jsonb_array_length(res->'conflicts') = 0,
    format('first push: %s', res);
  assert exists (select 1 from jsonb_array_elements(res->'applied') a
                 where a.value->>'table' = 'recurring_rules' and (a.value->>'version')::int = 1), 'rule applied';

  -- Stale base version → conflict; wrong currency → refused; currency now locked.
  res := public.apply_push(u, jsonb_build_object('recurring_rules', jsonb_build_array(
    rule || jsonb_build_object('description', 'Rent (stale)', 'base_version', 0))));
  assert res->'conflicts'->0->>'table' = 'recurring_rules', format('stale rule: %s', res);
  res := public.apply_push(u, jsonb_build_object('recurring_rules', jsonb_build_array(
    rule || jsonb_build_object('base_version', 1, 'group_currency', 'USD'))));
  assert res->'rejected'->0->>'code' = 'CURRENCY_MISMATCH', format('currency: %s', res);
  select version into v from public.groups where id = g::uuid;
  res := public.apply_push(u, jsonb_build_object('groups', jsonb_build_array(jsonb_build_object(
    'id', g, 'name', 'Flat 302', 'simplify_debts', true, 'currency', 'EUR',
    'created_at', 1, 'updated_at', 2, 'deleted_at', null, 'base_version', v))));
  assert res->'rejected'->0->>'code' = 'CURRENCY_LOCKED', format('rule must lock currency: %s', res);

  -- ── 2. The generator creates due occurrences with the app's ids, once ──
  -- 2 Dec, 00:30 in Kolkata (still 1 Dec in UTC): Oct, Nov and Dec are due there.
  n := private.generate_recurring_occurrences('2026-12-02 00:30+05:30');
  assert n = 3, format('expected 3 occurrences, got %s', n);
  assert (select count(*) from public.expenses where id in (oct_id, nov_id, dec_id)) = 3,
    'server ids must equal the app''s ids';
  assert (select sum(amount_paise) from public.expense_shares where expense_id = dec_id) = 3000000, 'shares copied';
  assert (select actor_member_id is null and after->>'recurringRuleId' = rule_id
          from public.activity_log where id = oct_activity), 'history entry with the app''s id';

  n := private.generate_recurring_occurrences('2026-12-02 00:30+05:30');
  assert n = 0, 'second run must create nothing';

  -- A deleted occurrence stays deleted.
  update public.expenses set deleted_at = 5 where id = nov_id;
  n := private.generate_recurring_occurrences('2026-12-03 00:30+05:30');
  assert n = 0 and (select deleted_at from public.expenses where id = nov_id) = 5, 'no resurrection';

  -- ── 3. A phone pushing an occurrence the server already made gets a conflict (the app takes ours) ──
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(jsonb_build_object(
    'id', oct_id, 'group_id', g, 'description', 'Rent', 'amount_paise', 3000000, 'category', 'stay',
    'expense_date', '2026-10-01',
    'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(me, rahul)),
    'created_by_member_id', me, 'created_at', 9, 'updated_at', 9, 'deleted_at', null, 'base_version', 0,
    'group_currency', 'INR', 'recurring_rule_id', rule_id, 'occurrence_date', '2026-10-01',
    'payers', jsonb_build_array(jsonb_build_object('member_id', me, 'amount_paise', 3000000)),
    'shares', jsonb_build_array(
      jsonb_build_object('member_id', me, 'amount_paise', 1500000),
      jsonb_build_object('member_id', rahul, 'amount_paise', 1500000))))));
  assert res->'conflicts'->0->>'id' = oct_id::text, format('duplicate occurrence: %s', res);

  -- An expense can't claim to be an occurrence under a different id.
  begin
    update public.expenses set occurrence_date = '2026-10-02' where id = oct_id;
    assert false, 'mismatched occurrence id must fail';
  exception when check_violation then null;
  end;

  -- ── 4. Ended, deleted and someone-left rules stop ──
  update public.recurring_rules set end_date = '2026-12-31' where id = rule_id::uuid;
  n := private.generate_recurring_occurrences('2027-02-02 00:30+05:30');
  assert n = 0, format('ended rule must stop, made %s', n);

  update public.recurring_rules set end_date = null where id = rule_id::uuid;
  update public.members set deleted_at = 7 where id = rahul::uuid;
  n := private.generate_recurring_occurrences('2027-02-02 00:30+05:30');
  assert n = 0, 'rule naming someone who left must wait';

  update public.members set deleted_at = null where id = rahul::uuid;
  update public.recurring_rules set deleted_at = 8 where id = rule_id::uuid;
  n := private.generate_recurring_occurrences('2027-02-02 00:30+05:30');
  assert n = 0, 'deleted rule must stop';
end $$;

-- ── 5. Members pull rules and occurrence links ──
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  page jsonb;
  row_ jsonb;
begin
  page := public.pull_page(null, array['95000000-0000-0000-0000-000000000001'::uuid], 300);
  assert jsonb_array_length(page->'recurring_rules') = 1, format('rules in pull: %s', page->'recurring_rules');
  row_ := page->'recurring_rules'->0;
  assert row_->>'start_date' = '2026-10-01' and jsonb_typeof(row_->'shares') = 'array', format('rule shape: %s', row_);
  select value into row_ from jsonb_array_elements(page->'expenses')
  where value->>'id' = 'e4e177ea-5280-5b84-b36a-896f093bcba1';
  assert row_->>'recurring_rule_id' = '96000000-0000-0000-0000-000000000001'
     and row_->>'occurrence_date' = '2026-10-01', format('occurrence link: %s', row_);
end $$;

-- Not a member: no rules.
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-0000000000ff","role":"authenticated"}';
do $$
begin
  assert (select count(*) from public.recurring_rules) = 0, 'outsiders must not see rules';
end $$;

reset role;
rollback;

select 'Recurring smoke test passed' as result;
