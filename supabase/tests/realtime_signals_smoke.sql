-- Realtime signal access smoke test. Wrapped in a transaction and rolled back: leaves no data.
-- Checks who may receive 'group:<id>' broadcasts and that nobody can send them from a phone.
begin;

-- ── Fixtures (as postgres) ─────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'asha.rt@test.local'),
  ('a1000000-0000-0000-0000-000000000002', 'rahul.rt@test.local'),
  ('a1000000-0000-0000-0000-000000000003', 'chetan.rt@test.local');

insert into public.groups (id, name, created_at, updated_at) values
  ('91000000-0000-0000-0000-000000000001', 'Goa Trip', 1, 1);

insert into public.members (id, group_id, display_name, user_id, deleted_at, created_at, updated_at) values
  ('b1000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'Asha', 'a1000000-0000-0000-0000-000000000001', null, 1, 1),
  -- Rahul left the group: no more signals for him.
  ('b1000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', 'Rahul', 'a1000000-0000-0000-0000-000000000002', 5, 1, 5);

do $$
begin
  assert exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages'
      and policyname = 'group members receive change signals' and cmd = 'SELECT'
  ), 'receive policy missing on realtime.messages';

  assert not exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL')
  ), 'phones must not be able to send group signals';
end $$;

-- ── As Asha (active member) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  assert private.can_receive_group_signal('group:91000000-0000-0000-0000-000000000001'),
    'an active member should receive signals';
  assert not private.can_receive_group_signal('group:91000000-0000-0000-0000-000000000099'),
    'no signals for a group you are not in';
  assert not private.can_receive_group_signal('91000000-0000-0000-0000-000000000001'),
    'topic without the group: prefix must be refused';
  assert not private.can_receive_group_signal('group:not-a-uuid'), 'malformed topic must be refused, not error';
  assert not private.can_receive_group_signal(null), 'null topic must be refused';
end $$;

-- ── As Rahul (removed) and Chetan (never a member) ─────────────────────
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  assert not private.can_receive_group_signal('group:91000000-0000-0000-0000-000000000001'),
    'a removed member must stop receiving signals';
end $$;

set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  assert not private.can_receive_group_signal('group:91000000-0000-0000-0000-000000000001'),
    'a non-member must not receive signals';
end $$;

-- ── Anonymous ──────────────────────────────────────────────────────────
reset role;
set local role anon;
do $$
begin
  perform private.can_receive_group_signal('group:91000000-0000-0000-0000-000000000001');
  raise exception 'FAIL: anon can call can_receive_group_signal';
exception when insufficient_privilege then null;
end $$;

reset role;
rollback;

select 'Realtime signals smoke test passed' as result;
