-- Phase 6.2 smoke test: server-side zero-balance rule. Everything is rolled back.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/balance_guards_smoke.sql
begin;

insert into auth.users (id, email) values ('a6000000-0000-0000-0000-000000000001', 'guard-asha@example.test');

create function pg_temp.group_row(p_id uuid, p_deleted bigint, p_base int)
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'name', 'Guard smoke', 'simplify_debts', true,
    'created_at', 1, 'updated_at', 2, 'deleted_at', p_deleted, 'base_version', p_base)
$$;

create function pg_temp.member_row(p_id uuid, p_group uuid, p_name text, p_user uuid, p_deleted bigint, p_base int)
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'group_id', p_group, 'display_name', p_name, 'user_id', p_user,
    'upi_vpa', null, 'created_at', 1, 'updated_at', 2, 'deleted_at', p_deleted, 'base_version', p_base)
$$;

do $$
declare
  u_asha  constant uuid := 'a6000000-0000-0000-0000-000000000001';
  g       constant uuid := '96000000-0000-0000-0000-000000000001';
  m_asha  constant uuid := 'b6000000-0000-0000-0000-000000000001';
  m_rahul constant uuid := 'b6000000-0000-0000-0000-000000000002';
  e1      constant uuid := 'e6000000-0000-0000-0000-000000000001';
  s1      constant uuid := 'c6000000-0000-0000-0000-000000000001';
  v jsonb;
begin
  -- Fixture: Asha's group with placeholder Rahul; Asha paid ₹600 split equally, so Rahul owes ₹300.
  v := public.apply_push(u_asha, jsonb_build_object(
    'groups', jsonb_build_array(pg_temp.group_row(g, null, 0)),
    'members', jsonb_build_array(
      pg_temp.member_row(m_asha, g, 'Asha', u_asha, null, 0),
      pg_temp.member_row(m_rahul, g, 'Rahul', null, null, 0)),
    'expenses', jsonb_build_array(jsonb_build_object(
      'id', e1, 'group_id', g, 'description', 'Dinner', 'amount_paise', 60000, 'category', 'general',
      'expense_date', '2026-10-01',
      'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(m_asha, m_rahul)),
      'created_by_member_id', m_asha, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0,
      'payers', jsonb_build_array(jsonb_build_object('member_id', m_asha, 'amount_paise', 60000)),
      'shares', jsonb_build_array(
        jsonb_build_object('member_id', m_asha, 'amount_paise', 30000),
        jsonb_build_object('member_id', m_rahul, 'amount_paise', 30000))))));
  assert jsonb_array_length(v->'applied') = 4 and jsonb_array_length(v->'rejected') = 0, 'fixture: ' || v::text;
  assert private.member_balance(m_rahul) = -30000, 'Rahul should owe 300';
  assert private.member_balance(m_asha) = 30000, 'Asha should be owed 300';

  -- 1. Removing Rahul while he owes money is refused and undone.
  v := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_rahul, g, 'Rahul', null, 5, 1))));
  assert v->'rejected' @> jsonb_build_array(jsonb_build_object(
    'table', 'members', 'id', m_rahul, 'code', 'MEMBER_HAS_BALANCE', 'detail', '-30000')), '1: ' || v::text;
  assert not (v->'applied' @> jsonb_build_array(jsonb_build_object('table', 'members', 'id', m_rahul))),
    '1: the removal must not be reported as applied';
  assert (select deleted_at from public.members where id = m_rahul) is null, '1: Rahul must be active again';
  assert exists (select 1 from public.activity_log where entity_id = m_rahul and action = 'restore'),
    '1: the restore must be logged';

  -- 2. Deleting the group with unsettled balances is refused and undone.
  v := public.apply_push(u_asha, jsonb_build_object('groups', jsonb_build_array(pg_temp.group_row(g, 6, 1))));
  assert v->'rejected' @> jsonb_build_array(jsonb_build_object(
    'table', 'groups', 'id', g, 'code', 'GROUP_HAS_BALANCES')), '2: ' || v::text;
  assert (select deleted_at from public.groups where id = g) is null, '2: the group must be active again';

  -- 3. Settling up and removing in the same batch works (the check runs after the whole batch).
  v := public.apply_push(u_asha, jsonb_build_object(
    'members', jsonb_build_array(pg_temp.member_row(m_rahul, g, 'Rahul', null, 7, 3)),
    'settlements', jsonb_build_array(jsonb_build_object(
      'id', s1, 'group_id', g, 'from_member_id', m_rahul, 'to_member_id', m_asha, 'amount_paise', 30000,
      'method', 'cash', 'note', null, 'settled_at', 7, 'created_by_member_id', m_asha,
      'created_at', 7, 'updated_at', 7, 'deleted_at', null, 'base_version', 0))));
  assert jsonb_array_length(v->'rejected') = 0 and jsonb_array_length(v->'conflicts') = 0, '3: ' || v::text;
  assert (select deleted_at from public.members where id = m_rahul) = 7, '3: Rahul must be removed';

  -- 4. With everyone settled, the group can be deleted.
  v := public.apply_push(u_asha, jsonb_build_object('groups', jsonb_build_array(pg_temp.group_row(g, 8, 3))));
  assert jsonb_array_length(v->'rejected') = 0, '4: ' || v::text;
  assert (select deleted_at from public.groups where id = g) = 8, '4: the group must be deleted';

  raise notice 'balance_guards_smoke: all checks passed';
end $$;

rollback;