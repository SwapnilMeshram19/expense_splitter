-- Home services smoke test: services and day marks through api_apply, version checks, the bill
-- link, currency lock, snapshots and RLS. One transaction, rolled back: leaves no data.
-- Run: source ~/.supabase-dev.env && psql -v ON_ERROR_STOP=1 -f supabase/tests/household_smoke.sql
begin;

insert into auth.users (id, email) values
  ('a7100000-0000-0000-0000-000000000001', 'asha.home@test.local'),
  ('a7100000-0000-0000-0000-000000000002', 'riya.home@test.local');

set local role service_role;

create function pg_temp.mark_id(p_service uuid, p_date date) returns uuid language sql as $$
  select extensions.uuid_generate_v5('3f6b2c1e-8d4a-4b7e-9c05-6a1d2e8f4b90'::uuid,
                                     p_service::text || '/' || to_char(p_date, 'YYYY-MM-DD'))
$$;

create function pg_temp.service_row(p_base int, p_bills jsonb default '{}'::jsonb, p_currency text default 'INR')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', '71100000-0000-0000-0000-000000000001', 'group_id', '97100000-0000-0000-0000-000000000001',
    'name', 'Milk', 'kind', 'per_unit', 'unit', 'L', 'default_qty', 100,
    'rates', '[{"from":"2026-10-01","rate_paise":3000},{"from":"2026-10-15","rate_paise":3200}]'::jsonb,
    'weekdays', 127, 'paid_leaves', 0, 'start_date', '2026-10-01', 'end_date', null, 'bills', p_bills,
    'created_by_member_id', 'b7100000-0000-0000-0000-000000000001',
    'created_at', 10, 'updated_at', 10, 'deleted_at', null, 'group_currency', p_currency, 'base_version', p_base)
$$;

create function pg_temp.mark_row(p_qty int, p_base int, p_by uuid default 'b7100000-0000-0000-0000-000000000001')
returns jsonb language sql as $$
  select jsonb_build_object(
    'id', pg_temp.mark_id('71100000-0000-0000-0000-000000000001', '2026-10-05'),
    'group_id', '97100000-0000-0000-0000-000000000001', 'service_id', '71100000-0000-0000-0000-000000000001',
    'mark_date', '2026-10-05', 'qty', p_qty, 'marked_by_member_id', p_by,
    'created_at', 20, 'updated_at', 21, 'base_version', p_base)
$$;

do $$
declare
  u  constant uuid := 'a7100000-0000-0000-0000-000000000001';
  g  constant uuid := '97100000-0000-0000-0000-000000000001';
  svc constant uuid := '71100000-0000-0000-0000-000000000001';
  res jsonb;
  snap jsonb;
begin
  -- Fixture: Asha's group with Riya.
  res := public.api_apply(u, gen_random_uuid(), 'group.create', g, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', g, 'name', 'Flat 4B', 'simplify_debts', true, 'currency', 'INR',
      'budget_paise', null, 'budget_period', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(
      jsonb_build_object('id', 'b7100000-0000-0000-0000-000000000001', 'group_id', g, 'display_name', 'Asha',
        'user_id', u, 'upi_vpa', null, 'pay_methods', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0),
      jsonb_build_object('id', 'b7100000-0000-0000-0000-000000000002', 'group_id', g, 'display_name', 'Riya',
        'user_id', null, 'upi_vpa', null, 'pay_methods', null,
        'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0))));
  assert (res->>'ok')::boolean, format('fixture: %s', res);
  -- Riya joins (as accepting an invite does).
  update public.members set user_id = 'a7100000-0000-0000-0000-000000000002'
  where id = 'b7100000-0000-0000-0000-000000000002';

  -- ── 1. A service ──
  res := public.api_apply(u, gen_random_uuid(), 'household.create', g,
    jsonb_build_object('household_services', jsonb_build_array(pg_temp.service_row(0))));
  assert (res->>'ok')::boolean and (res->'versions'->>('household_services:' || svc))::int = 1, format('create: %s', res);

  -- Wrong currency, bad rates and a bill pointing at no expense are refused whole.
  res := public.api_apply(u, gen_random_uuid(), 'household.update', g,
    jsonb_build_object('household_services', jsonb_build_array(pg_temp.service_row(1, '{}', 'USD'))));
  assert res->'error'->>'code' = 'CURRENCY_MISMATCH', format('currency: %s', res);
  res := public.api_apply(u, gen_random_uuid(), 'household.update', g,
    jsonb_build_object('household_services', jsonb_build_array(pg_temp.service_row(1) || '{"rates":[{"from":"2026-10-02","rate_paise":3000}]}')));
  assert res->'error'->>'code' = 'INVALID', format('rates: %s', res);
  res := public.api_apply(u, gen_random_uuid(), 'household.postBill', g,
    jsonb_build_object('household_services', jsonb_build_array(pg_temp.service_row(1, '{"2026-10":"e7100000-0000-0000-0000-000000000009"}'))));
  assert res->'error'->>'detail' = 'BILL', format('bill link: %s', res);

  -- ── 2. Day marks ──
  res := public.api_apply(u, gen_random_uuid(), 'household.mark', g,
    jsonb_build_object('household_marks', jsonb_build_array(pg_temp.mark_row(0, 0))));
  assert (res->>'ok')::boolean, format('mark: %s', res);
  -- A second "new" row for the same day collides with the first instead of doubling up.
  res := public.api_apply(u, gen_random_uuid(), 'household.mark', g,
    jsonb_build_object('household_marks', jsonb_build_array(pg_temp.mark_row(200, 0))));
  assert res->'error'->>'code' = 'STALE', format('same day twice: %s', res);
  -- Back to usual keeps the row.
  res := public.api_apply(u, gen_random_uuid(), 'household.mark', g,
    jsonb_build_object('household_marks', jsonb_build_array(pg_temp.mark_row(null, 1))));
  assert (res->>'ok')::boolean, format('reset: %s', res);
  assert (select qty is null and version = 2 from public.household_marks where service_id = svc), 'row kept, version 2';
  -- A made-up id is refused by the check constraint.
  res := public.api_apply(u, gen_random_uuid(), 'household.mark', g,
    jsonb_build_object('household_marks', jsonb_build_array(
      pg_temp.mark_row(0, 0) || '{"id":"71100000-0000-0000-0000-0000000000aa"}')));
  assert res->'error'->>'code' = 'INVALID', format('bad id: %s', res);

  -- ── 3. Snapshot, rev and currency lock ──
  snap := private.group_snapshot(g);
  assert jsonb_array_length(snap->'household_services') = 1 and jsonb_array_length(snap->'household_marks') = 1, format('snapshot: %s', snap);
  assert (snap->>'currency_locked')::boolean, 'services lock the currency';
  res := public.api_apply(u, gen_random_uuid(), 'group.update', g, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', g, 'name', 'Flat 4B', 'simplify_debts', true, 'currency', 'USD',
      'budget_paise', null, 'budget_period', null, 'created_at', 1, 'updated_at', 5, 'deleted_at', null, 'base_version', 1))));
  assert not (res->>'ok')::boolean, format('currency change must fail: %s', res);
  assert (select currency from public.groups where id = g) = 'INR', 'still INR';

  -- ── 4. Delete: gone from the snapshot, marks with it ──
  res := public.api_apply(u, gen_random_uuid(), 'household.delete', g, jsonb_build_object('household_services',
    jsonb_build_array(pg_temp.service_row(1) || '{"deleted_at": 30, "updated_at": 30}')));
  assert (res->>'ok')::boolean, format('delete: %s', res);
  snap := private.group_snapshot(g);
  assert jsonb_array_length(snap->'household_services') = 0 and jsonb_array_length(snap->'household_marks') = 0, 'deleted';
  -- Days of a deleted service can't be marked.
  res := public.api_apply(u, gen_random_uuid(), 'household.mark', g,
    jsonb_build_object('household_marks', jsonb_build_array(pg_temp.mark_row(0, 2))));
  assert res->'error'->>'code' = 'FORBIDDEN', format('mark deleted: %s', res);
end $$;

-- ── 5. RLS: members read, others don't ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7100000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  assert (select count(*) from public.household_marks) = 1, 'member sees the marks';
end $$;
set local request.jwt.claims = '{"sub":"a7100000-0000-0000-0000-0000000000ff","role":"authenticated"}';
do $$ begin
  assert (select count(*) from public.household_services) = 0, 'outsider sees nothing';
end $$;

rollback;
