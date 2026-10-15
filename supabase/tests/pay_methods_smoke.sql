-- Payment details smoke test: shape check, ownership, old builds, detach. Everything is rolled back.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pay_methods_smoke.sql
begin;

insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000001', 'pay-asha@example.test'),
  ('a9000000-0000-0000-0000-000000000002', 'pay-rahul@example.test');

set local role service_role;

create function pg_temp.member_row(p_id uuid, p_group uuid, p_name text, p_user uuid, p_base int)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p_id, 'group_id', p_group, 'display_name', p_name, 'user_id', p_user, 'upi_vpa', null,
    'created_at', 1, 'updated_at', 2, 'deleted_at', null, 'base_version', p_base)
$$;

do $$
declare
  u_asha  constant uuid := 'a9000000-0000-0000-0000-000000000001';
  u_rahul constant uuid := 'a9000000-0000-0000-0000-000000000002';
  g       constant uuid := '99000000-0000-0000-0000-000000000001';
  m_asha  constant uuid := 'b9000000-0000-0000-0000-000000000001';
  m_rahul constant uuid := 'b9000000-0000-0000-0000-000000000002';
  m_mom   constant uuid := 'b9000000-0000-0000-0000-000000000003';
  paypal  constant jsonb := '[{"kind":"link","url":"https://paypal.me/asha"}]';
  v jsonb;
  ver int;
begin
  -- ── 1. Created with details ──
  v := public.apply_push(u_asha, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object(
      'id', g, 'name', 'Pay smoke', 'simplify_debts', true, 'currency', 'EUR',
      'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(
      pg_temp.member_row(m_asha, g, 'Asha', u_asha, 0) || jsonb_build_object('pay_methods', paypal),
      pg_temp.member_row(m_mom, g, 'Mom', null, 0))));
  assert jsonb_array_length(v->'rejected') = 0, format('create: %s', v);
  assert (select pay_methods from public.members where id = m_asha) = paypal, 'stored';
  assert (select pay_methods is null from public.members where id = m_mom), 'absent key on insert = null';

  insert into public.members (id, group_id, display_name, user_id, created_at, updated_at)
  values (m_rahul, g, 'Rahul', u_rahul, 1, 1);

  -- ── 2. An older build (no key) keeps them ──
  select version into ver from public.members where id = m_asha;
  v := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_asha, g, 'Asha M', u_asha, ver))));
  assert jsonb_array_length(v->'applied') = 1, format('rename: %s', v);
  assert (select pay_methods from public.members where id = m_asha) = paypal, 'old build keeps them';

  -- ── 3. Shape check ──
  select version into ver from public.members where id = m_mom;
  foreach v in array array[
    '[{"kind":"link","url":"http://paypal.me/x"}]',
    '[{"kind":"link","url":"javascript:alert(1)"}]',
    '[{"kind":"crypto","address":"x"}]',
    '[{"kind":"bank","text":123}]',
    '{"kind":"bank","text":"x"}',
    '[]',
    '[1,2,3,4,5,6,7]'
  ]::jsonb[] loop
    declare r jsonb;
    begin
      r := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
        pg_temp.member_row(m_mom, g, 'Mom', null, ver) || jsonb_build_object('pay_methods', v))));
      assert r->'rejected'->0->>'code' = 'INVALID', format('%s must be refused: %s', v, r);
    end;
  end loop;

  -- ── 4. Placeholder: anyone in the group; null clears ──
  v := public.apply_push(u_rahul, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_mom, g, 'Mom', null, ver)
      || jsonb_build_object('pay_methods', '[{"kind":"iban","name":"Mom","iban":"DE89370400440532013000"}]'::jsonb))));
  assert jsonb_array_length(v->'applied') = 1, format('placeholder: %s', v);
  select version into ver from public.members where id = m_mom;
  v := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_mom, g, 'Mom', null, ver) || jsonb_build_object('pay_methods', null))));
  assert (select pay_methods is null from public.members where id = m_mom), 'null clears';

  -- ── 5. Claimed member: only the owner ──
  select version into ver from public.members where id = m_rahul;
  v := public.apply_push(u_asha, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_rahul, g, 'Rahul', u_rahul, ver) || jsonb_build_object('pay_methods', paypal))));
  assert v->'rejected' @> jsonb_build_array(jsonb_build_object('id', m_rahul, 'detail', '23V01')),
    format('foreign change must be refused: %s', v);
  v := public.apply_push(u_rahul, jsonb_build_object('members', jsonb_build_array(
    pg_temp.member_row(m_rahul, g, 'Rahul', u_rahul, ver)
      || jsonb_build_object('pay_methods', '[{"kind":"link","url":"https://revolut.me/rahul"}]'::jsonb))));
  assert jsonb_array_length(v->'applied') = 1, format('own change: %s', v);

  -- ── 6. Visible in pulls; detached account loses them ──
  assert (select pay_methods is not null from public.members where id = m_rahul), 'stored for owner';
  update public.members set user_id = null where id = m_rahul;
  assert (select pay_methods is null from public.members where id = m_rahul), 'detached loses them';
end $$;

reset role;
rollback;

select 'Pay methods smoke test passed' as result;
