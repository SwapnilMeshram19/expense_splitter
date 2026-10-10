-- Notes + receipts smoke test. One transaction, rolled back: leaves no data (storage rows included;
-- no files are uploaded, the policies are checked on storage.objects directly).
begin;

insert into auth.users (id, email) values
  ('a4000000-0000-0000-0000-000000000001', 'asha.receipt@test.local'),
  ('a4000000-0000-0000-0000-000000000002', 'outsider.receipt@test.local');

set local role service_role;

do $$
declare
  u constant uuid := 'a4000000-0000-0000-0000-000000000001';
  g constant text := '94000000-0000-0000-0000-000000000001';
  me constant text := 'b4000000-0000-0000-0000-000000000001';
  e constant text := 'e4000000-0000-0000-0000-000000000001';
  r1 constant text := 'c4000000-0000-0000-0000-000000000001';
  base jsonb;
  res jsonb;
  v integer;
begin
  base := jsonb_build_object(
    'id', e, 'group_id', g, 'description', 'Lunch', 'amount_paise', 50000, 'category', 'food',
    'expense_date', '2026-10-01',
    'split_input', jsonb_build_object('type', 'equal', 'memberIds', jsonb_build_array(me)),
    'created_by_member_id', me, 'created_at', 1, 'updated_at', 1, 'deleted_at', null,
    'base_version', 0, 'group_currency', 'INR',
    'original_currency', null, 'original_amount_minor', null, 'fx_rate', null,
    'payers', jsonb_build_array(jsonb_build_object('member_id', me, 'amount_paise', 50000)),
    'shares', jsonb_build_array(jsonb_build_object('member_id', me, 'amount_paise', 50000)));

  -- ── 1. Note and receipt are stored ──
  res := public.apply_push(u, jsonb_build_object(
    'groups', jsonb_build_array(jsonb_build_object('id', g, 'name', 'Receipts', 'simplify_debts', true,
      'currency', 'INR', 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'members', jsonb_build_array(jsonb_build_object('id', me, 'group_id', g, 'display_name', 'Asha',
      'user_id', u, 'upi_vpa', null, 'created_at', 1, 'updated_at', 1, 'deleted_at', null, 'base_version', 0)),
    'expenses', jsonb_build_array(base || jsonb_build_object('note', E'Table 4\nincl. tip', 'receipt_id', r1))));
  assert jsonb_array_length(res->'rejected') = 0, format('create rejected: %s', res);
  assert (select note from public.expenses where id = e::uuid) = E'Table 4\nincl. tip', 'note stored';
  assert (select receipt_id::text from public.expenses where id = e::uuid) = r1, 'receipt stored';

  -- ── 2. An older build (no keys) keeps both ──
  select version into v from public.expenses where id = e::uuid;
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    base || jsonb_build_object('description', 'Lunch (old build)', 'updated_at', 2, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('old-build edit: %s', res);
  assert (select row(note, receipt_id::text)::text from public.expenses where id = e::uuid)
    = row(E'Table 4\nincl. tip', r1)::text, 'old build must not clear note/receipt';

  -- ── 3. Explicit nulls clear them ──
  select version into v from public.expenses where id = e::uuid;
  res := public.apply_push(u, jsonb_build_object('expenses', jsonb_build_array(
    base || jsonb_build_object('note', null, 'receipt_id', null, 'updated_at', 3, 'base_version', v))));
  assert jsonb_array_length(res->'applied') = 1, format('clear: %s', res);
  assert (select note is null and receipt_id is null from public.expenses where id = e::uuid), 'cleared';

  -- ── 4. The database refuses non-canonical notes and upper-case receipt ids ──
  begin
    update public.expenses set note = E'  padded' where id = e::uuid;
    assert false, 'padded note must fail';
  exception when check_violation then null;
  end;
  begin
    update public.expenses set note = E'a\n\n\nb' where id = e::uuid;
    assert false, 'three newlines must fail';
  exception when check_violation then null;
  end;
  begin
    update public.expenses set note = repeat('x', 501) where id = e::uuid;
    assert false, 'long note must fail';
  exception when check_violation then null;
  end;

  -- Receipt r1 is current again for the storage checks below.
  update public.expenses set receipt_id = r1::uuid where id = e::uuid;

  assert (select not public and file_size_limit = 1048576 and allowed_mime_types = array['image/jpeg']
          from storage.buckets where id = 'receipts'), 'receipts bucket is private, 1 MB, JPEG only';
end $$;

-- ── 5. Storage policies, as the member ──
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  path_r1 constant text := '94000000-0000-0000-0000-000000000001/e4000000-0000-0000-0000-000000000001/c4000000-0000-0000-0000-000000000001.jpg';
  path_r2 constant text := '94000000-0000-0000-0000-000000000001/e4000000-0000-0000-0000-000000000001/c4000000-0000-0000-0000-000000000002.jpg';
  n integer;
begin
  -- The current receipt can be uploaded and read.
  insert into storage.objects (bucket_id, name) values ('receipts', path_r1);
  assert (select count(*) from storage.objects where bucket_id = 'receipts' and name = path_r1) = 1, 'member reads';

  -- Any other name is refused: a different receipt id, odd paths, another bucket's rules.
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', path_r2);
    assert false, 'non-current receipt upload must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', 'free-storage/movie.jpg');
    assert false, 'arbitrary path must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', upper(path_r1));
    assert false, 'upper-case path must be refused';
  exception when insufficient_privilege then null;
  end;

  -- The current receipt can't be deleted.
  delete from storage.objects where bucket_id = 'receipts' and name = path_r1;
  get diagnostics n = row_count;
  assert n = 0, 'current receipt must not be deletable';
end $$;

-- ── 6. A non-member sees and deletes nothing ──
set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  n integer;
begin
  assert (select count(*) from storage.objects where bucket_id = 'receipts') = 0, 'outsider must not read';
  delete from storage.objects where bucket_id = 'receipts';
  get diagnostics n = row_count;
  assert n = 0, 'outsider must not delete';
end $$;

-- ── 7. After the photo is replaced, the member can delete the old one ──
reset role;
update public.expenses set receipt_id = 'c4000000-0000-0000-0000-000000000002'
where id = 'e4000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  n integer;
begin
  delete from storage.objects
  where bucket_id = 'receipts'
    and name = '94000000-0000-0000-0000-000000000001/e4000000-0000-0000-0000-000000000001/c4000000-0000-0000-0000-000000000001.jpg';
  get diagnostics n = row_count;
  assert n = 1, 'replaced receipt must be deletable';
end $$;

reset role;
rollback;

select 'Notes + receipts smoke test passed' as result;
