-- Invites smoke test. One transaction, rolled back: leaves no data.
-- Run: source ~/.supabase-dev.env && psql -v ON_ERROR_STOP=1 -f supabase/tests/invites_smoke.sql
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'asha@test.local'),
  ('a0000000-0000-0000-0000-00000000000b', 'bala@test.local'),
  ('a0000000-0000-0000-0000-00000000000c', 'chetan@test.local'),
  ('a0000000-0000-0000-0000-00000000000d', 'dev@test.local'),
  ('a0000000-0000-0000-0000-00000000000e', 'esha@test.local');

insert into public.groups (id, name, created_at, updated_at)
values ('90000000-0000-0000-0000-000000000001', 'Goa', 1, 1);

insert into public.members (id, group_id, display_name, user_id, created_at, updated_at) values
  ('b0000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-000000000001', 'Asha',
   'a0000000-0000-0000-0000-00000000000a', 1, 1),
  ('b0000000-0000-0000-0000-0000000000f1', '90000000-0000-0000-0000-000000000001', 'Mom', null, 1, 1);

set local role authenticated;

-- 1. Asha (member) creates an invite. The table itself is not readable by clients.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare res jsonb;
begin
  res := public.create_invite('90000000-0000-0000-0000-000000000001');
  assert res->>'status' = 'OK', format('create: %s', res);
  assert res->>'code' ~ '^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$', format('code format: %s', res->>'code');
  perform set_config('test.code', res->>'code', true);

  begin
    perform 1 from public.invites;
    raise exception 'FAIL: invites table is readable by clients';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 2. Esha (not a member) cannot create invites for the group.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000e","role":"authenticated"}';
do $$
begin
  assert public.create_invite('90000000-0000-0000-0000-000000000001')->>'status' = 'FORBIDDEN',
    'non-member must not create invites';
end $$;

-- 3. Bala previews (forgiving input), sees no money, then claims "Mom".
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000b","role":"authenticated"}';
do $$
declare
  res jsonb;
  code text := current_setting('test.code');
begin
  res := public.preview_invite(lower(replace(code, '-', ' ')));
  assert res->>'status' = 'OK', format('preview: %s', res);
  assert res->>'group_name' = 'Goa', 'preview shows the group name';
  assert (res->>'member_count')::int = 2, 'preview shows the member count';
  assert res->'placeholders' = '[{"id":"b0000000-0000-0000-0000-0000000000f1","display_name":"Mom"}]'::jsonb,
    format('only unclaimed placeholders: %s', res->'placeholders');
  assert not (res ? 'expenses') and not (res ? 'balances'), 'preview must not expose money';
  assert (select count(*) from public.groups) = 0, 'group must be invisible before joining';

  res := public.join_group(code, 'b0000000-0000-0000-0000-0000000000f1');
  assert res->>'status' = 'JOINED' and res->>'member_id' = 'b0000000-0000-0000-0000-0000000000f1',
    format('claim: %s', res);
  assert (select count(*) from public.groups) = 1, 'group must be visible after joining';

  res := public.join_group(code);
  assert res->>'status' = 'ALREADY_MEMBER', format('second join: %s', res);
end $$;

-- 4. Chetan: the claimed placeholder is refused; he joins as a new member.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$
declare
  res jsonb;
  code text := current_setting('test.code');
begin
  res := public.join_group(code, 'b0000000-0000-0000-0000-0000000000f1');
  assert res->>'status' = 'ALREADY_CLAIMED', format('double claim: %s', res);

  res := public.join_group(code, null, '  Chetan  ');
  assert res->>'status' = 'JOINED', format('join as new: %s', res);
  perform set_config('test.chetan_member', res->>'member_id', true);
  assert (select display_name from public.members where id = (res->>'member_id')::uuid) = 'Chetan',
    'new member uses the trimmed name';
end $$;

-- 5. Dev: 10 wrong guesses lock him out, even with the right code.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000d","role":"authenticated"}';
do $$
declare res jsonb;
begin
  assert public.preview_invite('abc')->>'status' = 'INVALID', 'malformed input is just invalid';
  for i in 1..10 loop
    res := public.preview_invite('XXXXXXX' || substr('23456789AB', i, 1));
    assert res->>'status' = 'INVALID', format('guess %s: %s', i, res);
  end loop;
  assert public.preview_invite(current_setting('test.code'))->>'status' = 'RATE_LIMITED',
    'locked out after 10 wrong guesses';
  assert public.join_group(current_setting('test.code'))->>'status' = 'RATE_LIMITED',
    'join is locked out too';
end $$;

-- 6. Expired invites are refused.
reset role;
update public.invites set expires_at = now() - interval '1 minute';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000e","role":"authenticated"}';
do $$
begin
  assert public.preview_invite(current_setting('test.code'))->>'status' = 'EXPIRED', 'expired invite';
end $$;

-- 7. A removed member rejoins with a new invite: their own row is restored.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare res jsonb;
begin
  res := public.create_invite('90000000-0000-0000-0000-000000000001');
  assert res->>'status' = 'OK', format('second invite: %s', res);
  perform set_config('test.code2', res->>'code', true);
end $$;

reset role;
update public.members set deleted_at = 5 where id = current_setting('test.chetan_member')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000c","role":"authenticated"}';
do $$
declare res jsonb;
begin
  assert (select count(*) from public.groups) = 0, 'removed member loses access';
  res := public.join_group(current_setting('test.code2'), null, 'Someone else');
  assert res->>'status' = 'JOINED' and res->>'member_id' = current_setting('test.chetan_member'),
    format('rejoin must restore the old row: %s', res);
  assert (select deleted_at from public.members where id = current_setting('test.chetan_member')::uuid) is null,
    'restored row is active again';
end $$;

-- 8. Revoking: every active invite stops working.
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
do $$
declare res jsonb;
begin
  res := public.revoke_all_invites('90000000-0000-0000-0000-000000000001');
  assert res->>'status' = 'OK' and (res->>'revoked')::int >= 1, format('revoke: %s', res);
end $$;

set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-00000000000e","role":"authenticated"}';
do $$
begin
  assert public.preview_invite(current_setting('test.code2'))->>'status' = 'REVOKED', 'revoked invite';
end $$;

-- 9. Server-side bookkeeping: hashes only, use counts, and sync versions.
reset role;
do $$
begin
  assert not exists (select 1 from public.invites where code_hash = current_setting('test.code')),
    'plaintext codes must never be stored';
  assert (select use_count from public.invites order by created_at limit 1) = 2,
    'first invite used twice (Bala + Chetan)';
  assert (select version from public.members where id = 'b0000000-0000-0000-0000-0000000000f1') = 2,
    'claiming bumps the version so other phones pull it';
end $$;

-- 10. Anonymous callers get nothing.
set local role anon;
do $$
begin
  begin
    perform public.preview_invite('ABCDEFGH');
    raise exception 'FAIL: anon can preview invites';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;

select 'invites smoke test passed' as result;