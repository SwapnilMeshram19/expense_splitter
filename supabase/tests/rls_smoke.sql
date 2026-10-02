-- RLS + trigger smoke test. Wrapped in a transaction and rolled back: leaves no data.
begin;

-- ── Fixtures (as postgres) ─────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000001', 'asha@test.local', '{"full_name":"Asha Patil"}'),
  ('a0000000-0000-0000-0000-000000000002', 'rahul@test.local', null),
  ('a0000000-0000-0000-0000-000000000003', 'chetan@test.local', null);

insert into public.groups (id, name, created_at, updated_at) values
  ('90000000-0000-0000-0000-000000000001', 'Goa Trip', 1, 1),
  ('90000000-0000-0000-0000-000000000002', 'Chetan Flat', 1, 1);

insert into public.members (id, group_id, display_name, user_id, created_at, updated_at) values
  ('b0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Asha', 'a0000000-0000-0000-0000-000000000001', 1, 1),
  ('b0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'Rahul', 'a0000000-0000-0000-0000-000000000002', 1, 1),
  ('b0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000001', 'Mom', null, 1, 1),
  ('b0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000002', 'Chetan', 'a0000000-0000-0000-0000-000000000003', 1, 1);

insert into public.expenses (id, group_id, description, amount_paise, expense_date, split_input, created_by_member_id, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Dinner', 90000, '2026-10-01', '{"type":"equal"}', 'b0000000-0000-0000-0000-000000000001', 1, 1),
  ('e0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', 'Rent', 1500000, '2026-10-01', '{"type":"equal"}', 'b0000000-0000-0000-0000-000000000004', 1, 1);

insert into public.expense_payers (expense_id, member_id, amount_paise) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 90000),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', 1500000);

insert into public.expense_shares (expense_id, member_id, amount_paise) values
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 30000),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 30000),
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 30000),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000004', 1500000);

insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, created_at) values
  ('d0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'expense', 'e0000000-0000-0000-0000-000000000001', 'create', 'b0000000-0000-0000-0000-000000000001', 1);

-- ── Triggers ───────────────────────────────────────────────────────────
update public.groups set name = 'Goa Trip 2026', version = 99
where id = '90000000-0000-0000-0000-000000000001';

do $$
begin
  assert (select version from public.groups where id = '90000000-0000-0000-0000-000000000001') = 2,
    'version must be server-owned: insert=1, update=+1 (client value ignored)';
  assert (select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000001') = 'Asha Patil',
    'profile should use full_name from Google metadata';
  assert (select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000002') = 'rahul',
    'profile should fall back to email local part';

  begin
    update public.expenses set group_id = '90000000-0000-0000-0000-000000000002'
    where id = 'e0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: expense group_id change was allowed';
  exception when check_violation then null;
  end;

  begin
    update public.activity_log set action = 'delete' where id = 'd0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: activity_log update was allowed';
  exception when check_violation then null;
  end;

  begin
    insert into public.expenses (id, group_id, description, amount_paise, expense_date, split_input, created_by_member_id, created_at, updated_at)
    values (gen_random_uuid(), '90000000-0000-0000-0000-000000000001', 'Bad date', 100, '2026-02-30', '{}', 'b0000000-0000-0000-0000-000000000001', 1, 1);
    raise exception 'FAIL: invalid calendar date accepted';
  exception when datetime_field_overflow or invalid_datetime_format then null;
  end;
end $$;

-- ── Asha: sees only Goa Trip, can't write, owns only her profile ───────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare n int;
begin
  assert (select count(*) from public.groups) = 1, 'Asha should see exactly 1 group';
  assert (select count(*) from public.members) = 3, 'Asha should see the 3 Goa members (incl. placeholder)';
  assert (select count(*) from public.expenses) = 1, 'Asha should see 1 expense';
  assert (select count(*) from public.expense_payers) = 1, 'Asha should see 1 payer line';
  assert (select count(*) from public.expense_shares) = 3, 'Asha should see 3 share lines';
  assert (select count(*) from public.activity_log) = 1, 'Asha should see 1 activity entry';
  assert (select count(*) from public.profiles) = 1, 'Asha should see only her own profile';

  begin
    insert into public.expenses (id, group_id, description, amount_paise, expense_date, split_input, created_by_member_id, created_at, updated_at)
    values (gen_random_uuid(), '90000000-0000-0000-0000-000000000001', 'Sneaky', 100, '2026-10-01', '{}', 'b0000000-0000-0000-0000-000000000001', 1, 1);
    raise exception 'FAIL: direct insert into expenses was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.groups set name = 'Hacked';
    raise exception 'FAIL: direct update of groups was allowed';
  exception when insufficient_privilege then null;
  end;

  update public.profiles set display_name = 'Asha M' where id = 'a0000000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  assert n = 1, 'Asha should be able to rename herself';

  update public.profiles set display_name = 'Hacked' where id = 'a0000000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  assert n = 0, 'Asha must not update Rahul''s profile';

  begin
    update public.profiles set id = gen_random_uuid() where id = 'a0000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: profile id was updatable';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── Rahul: sees Goa until removed ──────────────────────────────────────
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  assert (select count(*) from public.groups) = 1, 'Rahul should see Goa Trip while a member';
end $$;

reset role;
update public.members set deleted_at = 2 where id = 'b0000000-0000-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  assert (select count(*) from public.groups) = 0, 'Removed member must lose server access';
  assert (select count(*) from public.expense_shares) = 0, 'Removed member must not see share lines';
end $$;

-- ── Chetan: only his own group ─────────────────────────────────────────
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  assert (select count(*) from public.groups) = 1, 'Chetan should see exactly 1 group';
  assert (select name from public.groups limit 1) = 'Chetan Flat', 'Chetan should see only his flat';
  assert (select count(*) from public.members) = 1, 'Chetan must not see Goa members';
end $$;

-- ── Anonymous (publishable key, no session): nothing but ping ──────────
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.groups;
    raise exception 'FAIL: anon can read groups';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.profiles;
    raise exception 'FAIL: anon can read profiles';
  exception when insufficient_privilege then null;
  end;
  assert public.ping() = 1, 'anon should be able to call ping()';
end $$;

reset role;
rollback;

select 'RLS smoke test passed' as result;