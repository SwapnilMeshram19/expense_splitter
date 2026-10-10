-- Notes and one receipt photo per expense (pre-release step 2).
--
-- * expenses.note: free text shared with the group, in the canonical form src/domain/note.ts
--   produces (≤ 500 chars, trimmed, no control characters except newline and tab).
-- * expenses.receipt_id: lowercase UUID naming the photo "<group>/<expense>/<receipt>.jpg" in the
--   private `receipts` bucket. A new photo gets a new id, so a photo never changes under a name.
-- * Builds from before this migration don't send either key: the values are left as they are, the
--   same way category labels work (20261010150000_custom_category_label.sql).
--
-- Storage access is decided by private.receipt_object_access():
--   read    active member of the group, and the expense exists in that group
--   write   same, and the expense currently points at exactly this receipt (no stray uploads,
--           no reusing the free storage for anything else; 1 MB JPEG max per file)
--   delete  active member, and the expense no longer points at this receipt (cleanup after a
--           photo was replaced or removed; the current photo can't be deleted by anyone)
-- No update policy: an object is never overwritten.

-- ── 1. Columns ─────────────────────────────────────────────────────────

alter table public.expenses
  add column note text,
  add column receipt_id uuid;

alter table public.expenses add constraint expenses_note_check check (
  note is null
  or (
    char_length(note) between 1 and 500
    and note = btrim(note, E' \n\t')
    and note !~ E'[\\x01-\\x08\\x0B-\\x1F\\x7F]'
    and note !~ E'\n\n\n'
  )
);

-- Lowercase only: the id is part of the storage path, and paths are compared as text.
alter table public.expenses add constraint expenses_receipt_id_check check (
  receipt_id is null or receipt_id::text = lower(receipt_id::text)
);

-- ── 2. Trigger: values sent with a push; kept when a build doesn't send them ──

create function private.apply_expense_extras()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := nullif(current_setting('app.push_expense_extras', true), '')::jsonb;
  v_row jsonb;
begin
  if v_map is null then
    return new; -- not a push: leave direct writes alone
  end if;
  v_row := v_map -> new.id::text;

  if v_row is not null and v_row ? 'note' then
    new.note := v_row ->> 'note';
  elsif tg_op = 'UPDATE' then
    new.note := old.note;
  end if;

  if v_row is not null and v_row ? 'receipt_id' then
    new.receipt_id := (v_row ->> 'receipt_id')::uuid;
  elsif tg_op = 'UPDATE' then
    new.receipt_id := old.receipt_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_expense_extras() from public, anon, authenticated;

create trigger expenses_extras
before insert or update on public.expenses
for each row execute function private.apply_expense_extras();

-- ── 3. apply_push publishes the extras, then runs the existing logic ──
-- Same layering as category labels: the previous public.apply_push (multi-currency) moves to
-- private and is called from the new one. Same name and signature: the Edge Function is unchanged.

alter function public.apply_push(uuid, jsonb) set schema private;
alter function private.apply_push(uuid, jsonb) rename to apply_push_currency;

revoke execute on function private.apply_push_currency(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.apply_push_currency(uuid, jsonb) to service_role;

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_result jsonb;
begin
  -- { "<expense id>": { "note": "…" | null, "receipt_id": "…" | null } }, only the keys the row
  -- carries. Wrongly typed values are dropped here and the row keeps its old value; the Edge
  -- Function has already rejected such rows anyway.
  perform set_config('app.push_expense_extras', coalesce((
    select jsonb_object_agg(
      lower(r.value->>'id'),
      -- Built by concatenation so an explicit null ("remove the note") survives.
      (case when r.value ? 'note' and jsonb_typeof(r.value->'note') in ('string', 'null')
            then jsonb_build_object('note', r.value->'note') else '{}'::jsonb end)
      || (case when jsonb_typeof(r.value->'receipt_id') = 'null'
               then jsonb_build_object('receipt_id', 'null'::jsonb)
               when r.value->>'receipt_id' ~ c_uuid
               then jsonb_build_object('receipt_id', lower(r.value->>'receipt_id'))
               else '{}'::jsonb end)
    )
    from jsonb_array_elements(coalesce(p_batch->'expenses', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and r.value->>'id' ~ c_uuid
      and (r.value ? 'note' or r.value ? 'receipt_id')
  ), '{}'::jsonb)::text, true);

  v_result := private.apply_push_currency(p_user, p_batch);

  perform set_config('app.push_expense_extras', '', true);
  return v_result;
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

-- ── 4. Storage: private bucket + member-only access ────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 1048576, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

create function private.receipt_object_access(p_name text, p_mode text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_part constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_group uuid;
  v_expense uuid;
  v_receipt uuid;
  v_found boolean := false;
  v_current uuid;
begin
  if p_name is null or p_name !~ ('^' || c_part || '/' || c_part || '/' || c_part || '\.jpg$') then
    return false;
  end if;
  v_group := split_part(p_name, '/', 1)::uuid;
  v_expense := split_part(p_name, '/', 2)::uuid;
  v_receipt := split_part(split_part(p_name, '/', 3), '.', 1)::uuid;

  if not exists (
    select 1 from public.members m
    where m.group_id = v_group and m.user_id = (select auth.uid()) and m.deleted_at is null
  ) then
    return false;
  end if;

  select true, e.receipt_id into v_found, v_current
  from public.expenses e
  where e.id = v_expense and e.group_id = v_group;

  return case p_mode
    when 'read' then coalesce(v_found, false)
    when 'write' then coalesce(v_found, false) and v_current = v_receipt
    when 'delete' then v_current is distinct from v_receipt
    else false
  end;
end;
$$;

revoke execute on function private.receipt_object_access(text, text) from public, anon;
grant execute on function private.receipt_object_access(text, text) to authenticated;

create policy receipts_select on storage.objects
for select to authenticated
using (bucket_id = 'receipts' and private.receipt_object_access(name, 'read'));

create policy receipts_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'receipts' and private.receipt_object_access(name, 'write'));

create policy receipts_delete on storage.objects
for delete to authenticated
using (bucket_id = 'receipts' and private.receipt_object_access(name, 'delete'));

notify pgrst, 'reload schema';
