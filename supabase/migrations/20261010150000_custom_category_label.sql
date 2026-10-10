-- Custom expense categories, shared with the group.
--
-- A custom category is category 'other' plus a label ("Petrol", "Maid"). Older app builds that
-- don't know labels keep working: they show "Other", and when they push an expense they don't
-- send category_label at all, so an existing label is left alone (unless they change the
-- category away from 'other', which clears it).
--
-- apply_push_core writes expenses with a fixed column list, so instead of rewriting it, the label
-- travels the same way the caller id does for the UPI trigger (Phase 4): public.apply_push
-- publishes the batch's labels as a transaction-local setting, and a BEFORE trigger on expenses
-- copies them in. Same name and signature for apply_push: the Edge Function needs no change.

-- ── 1. Column + rules (same limits as src/domain/categoryLabel.ts) ─────
alter table public.expenses add column category_label text;

alter table public.expenses add constraint expenses_category_label_check check (
  category_label is null
  or (
    category = 'other'
    and char_length(category_label) between 1 and 30
    and category_label = btrim(category_label)
    and category_label !~ '[[:cntrl:]]'
  )
);

-- ── 2. Trigger: apply the label sent with the push, keep it otherwise ──
create function private.apply_category_label()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_labels jsonb;
begin
  -- Only 'other' carries a label: moving to a real category drops it (also for old builds).
  if new.category is distinct from 'other' then
    new.category_label := null;
    return new;
  end if;

  v_labels := nullif(current_setting('app.push_category_labels', true), '')::jsonb;
  -- Key present (even with null): the client said what the label is. Absent: leave it as is.
  if v_labels is not null and v_labels ? new.id::text then
    new.category_label := v_labels ->> new.id::text;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_category_label() from public, anon, authenticated;

create trigger expenses_category_label
before insert or update on public.expenses
for each row execute function private.apply_category_label();

-- ── 3. apply_push publishes the labels, then runs the existing logic ──
alter function public.apply_push(uuid, jsonb) set schema private;
alter function private.apply_push(uuid, jsonb) rename to apply_push_guarded;

revoke execute on function private.apply_push_guarded(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.apply_push_guarded(uuid, jsonb) to service_role;

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  -- { "<expense id>": "Petrol" | null } for rows that carry the key. is_local = true: lives only
  -- until this RPC's transaction ends. A non-string label is ignored rather than stringified.
  perform set_config('app.push_category_labels', coalesce((
    select jsonb_object_agg(lower(r.value->>'id'), r.value->'category_label')
    from jsonb_array_elements(coalesce(p_batch->'expenses', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and r.value ? 'category_label'
      and jsonb_typeof(r.value->'category_label') in ('string', 'null')
      and r.value->>'id' ~ c_uuid
  ), '{}'::jsonb)::text, true);

  return private.apply_push_guarded(p_user, p_batch);
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
