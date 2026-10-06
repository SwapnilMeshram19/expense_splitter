-- Phase 4.1 smoke test: UPI ID format and ownership. Everything is rolled back.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/upi_vpa_smoke.sql
begin;

insert into auth.users (id, email) values
  ('a4000000-0000-0000-0000-000000000001', 'upi-asha@example.test'),
  ('a4000000-0000-0000-0000-000000000002', 'upi-rahul@example.test');

create function pg_temp.member_row(p_id uuid, p_group uuid, p_name text, p_user uuid, p_vpa text, p_base int)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p_id, 'group_id', p_group, 'display_name', p_name, 'user_id', p_user, 'upi_vpa', p_vpa,
    'created_at', 1, 'updated_at', 2, 'deleted_at', null, 'base_version', p_base)
$$;

do $$
declare
  u_asha  constant uuid := 'a4000000-0000-0000-0000-000000000001';
  u_rahul constant uuid := 'a4000000-0000-0000-0000-000000000002';
  g       constant uuid := '94000000-0000-0000-0000-000000000001';
  m_asha  constant uuid := 'b4000000-0000-0000-0000-000000000001';
  m_rahul constant uuid := 'b4000000-0000-0000-0000-000000000002';
  m_mom   constant uuid := 'b4000000-0000-0000-0000-000000000003';
  v jsonb;
begin
  -- Fixture: Asha creates the group with herself and a placeholder; Rahul joined (claimed row).
  v := public.apply_push(u_asha, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object(
      'id', g, 'name', 'UPI smoke', 'simplify_debts', true,
      'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(
      pg_temp.member_row(m_asha, g, 'Asha', u_asha, null, 0),
      pg_temp.member_row(m_mom, g, 'Mom', null, null, 0))));
  assert jsonb_array_length(v->'applied') = 3, 'fixture should apply: ' || v::text;

  insert into public.members (id, group_id, display_name, user_id, created_at, updated_at)
  values (m_rahul, g, 'Rahul', u_rahul, 1, 1);

  -- Any member may set a placeholder's UPI ID.
  v := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_mom, g, 'Mom', null, 'mom.k@oksbi', 1))));
  assert v->'applied' @> jsonb_build_array(jsonb_build_object('id', m_mom)),
    'placeholder VPA should apply: ' || v::text;

  -- Nobody else may change a claimed member's UPI ID.
  v := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_rahul, g, 'Rahul', u_rahul, 'asha@ybl', 1))));
  assert v->'rejected' @> jsonb_build_array(jsonb_build_object('id', m_rahul, 'detail', '23V01')),
    'foreign VPA change should be rejected: ' || v::text;
  assert (select upi_vpa from public.members where id = m_rahul) is null, 'VPA must be unchanged';

  -- The owner may.
  v := public.apply_push(u_rahul, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_rahul, g, 'Rahul', u_rahul, 'rahul.k@okaxis', 1))));
  assert v->'applied' @> jsonb_build_array(jsonb_build_object('id', m_rahul)),
    'own VPA should apply: ' || v::text;

  -- Format: uppercase / non-normalized input is rejected (clients normalize first).
  v := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_mom, g, 'Mom', null, 'Mom@OKSBI', 2))));
  assert v->'rejected' @> jsonb_build_array(jsonb_build_object('id', m_mom, 'detail', '23514')),
    'bad format should be rejected: ' || v::text;

  -- Direct writes outside apply_push (no caller identity) can't change a claimed member's UPI ID.
  -- (app.push_user is transaction-local; this whole test is one transaction, so reset it.)
  perform set_config('app.push_user', '', true);
  begin
    update public.members set upi_vpa = 'evil@ybl' where id = m_rahul;
    raise exception 'FAIL: direct VPA change of a claimed member was allowed';
  exception when sqlstate '23V01' then null;
  end;

  -- Detached account (auth user deleted → user_id null) loses its UPI ID.
  update public.members set user_id = null where id = m_rahul;
  assert (select upi_vpa from public.members where id = m_rahul) is null, 'detached member should lose VPA';

  raise notice 'upi_vpa_smoke: all checks passed';
end $$;

rollback;