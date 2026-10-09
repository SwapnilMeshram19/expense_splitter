-- Phase 6.2 · Server-side zero-balance rule.
--
-- The app already refuses to remove a member with a balance, or to delete a group with unsettled
-- balances. This enforces the same on the server, so an old or modified app can't make money
-- "vanish" from everyone else's balances.
--
-- Checked in the public.apply_push wrapper AFTER the whole batch is applied: "record Rahul's cash
-- payment, then remove Rahul" made offline arrives as one batch, and members are applied before
-- settlements. A violating removal/deletion is undone, reported as rejected, and logged as 'restore'.

-- ── Balance of one member (positive = is owed, negative = owes) ───────
create function private.member_balance(p_member uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select (
      coalesce((select sum(p.amount_paise) from public.expense_payers p
                join public.expenses e on e.id = p.expense_id
                where p.member_id = p_member and e.deleted_at is null), 0)
    - coalesce((select sum(s.amount_paise) from public.expense_shares s
                join public.expenses e on e.id = s.expense_id
                where s.member_id = p_member and e.deleted_at is null), 0)
    + coalesce((select sum(t.amount_paise) from public.settlements t
                where t.from_member_id = p_member and t.deleted_at is null), 0)
    - coalesce((select sum(t.amount_paise) from public.settlements t
                where t.to_member_id = p_member and t.deleted_at is null), 0)
  )::bigint
$$;

revoke execute on function private.member_balance(uuid) from public, anon, authenticated;
grant execute on function private.member_balance(uuid) to service_role;

-- ── Wrapper: caller identity (Phase 4) + balance guards (Phase 6.2) ────
create or replace function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_now constant bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_removed_members uuid[];
  v_deleted_groups uuid[];
  v_result jsonb;
  v_applied jsonb;
  v_rejected jsonb;
  v_id uuid;
  v_balance bigint;
begin
  -- Transaction-local: read by private.guard_member_vpa() (Phase 4).
  perform set_config('app.push_user', coalesce(p_user::text, ''), true);

  -- What this batch removes/deletes: active on the server now, deleted in the batch.
  -- (Malformed ids are skipped here; apply_push_core rejects them per row.)
  select coalesce(array_agg(m.id), '{}') into v_removed_members
  from jsonb_array_elements(coalesce(p_batch->'members', '[]'::jsonb)) r
  join public.members m
    on m.id = case when r.value->>'id' ~ c_uuid then (r.value->>'id')::uuid end
  where r.value->>'deleted_at' is not null and m.deleted_at is null;

  select coalesce(array_agg(g.id), '{}') into v_deleted_groups
  from jsonb_array_elements(coalesce(p_batch->'groups', '[]'::jsonb)) r
  join public.groups g
    on g.id = case when r.value->>'id' ~ c_uuid then (r.value->>'id')::uuid end
  where r.value->>'deleted_at' is not null and g.deleted_at is null;

  v_result := private.apply_push_core(p_user, p_batch);
  if cardinality(v_removed_members) = 0 and cardinality(v_deleted_groups) = 0 then
    return v_result;
  end if;

  v_applied := coalesce(v_result->'applied', '[]'::jsonb);
  v_rejected := coalesce(v_result->'rejected', '[]'::jsonb);

  -- Members removed with a non-zero balance: put them back.
  foreach v_id in array v_removed_members loop
    continue when not exists (select 1 from public.members where id = v_id and deleted_at is not null);
    v_balance := private.member_balance(v_id);
    continue when v_balance = 0;

    update public.members set deleted_at = null, updated_at = v_now where id = v_id;
    insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, after, created_at)
    select gen_random_uuid(), m.group_id, 'member', m.id, 'restore', null,
           jsonb_build_object('displayName', m.display_name, 'reason', 'MEMBER_HAS_BALANCE'), v_now
    from public.members m where m.id = v_id;

    select coalesce(jsonb_agg(a.value), '[]'::jsonb) into v_applied
    from jsonb_array_elements(v_applied) as a(value)
    where not (a.value->>'table' = 'members' and a.value->>'id' = v_id::text);
    v_rejected := v_rejected || jsonb_build_object(
      'table', 'members', 'id', v_id, 'code', 'MEMBER_HAS_BALANCE', 'detail', v_balance::text);
  end loop;

  -- Groups deleted while someone still has a balance: put them back.
  foreach v_id in array v_deleted_groups loop
    continue when not exists (select 1 from public.groups where id = v_id and deleted_at is not null);
    continue when not exists (
      select 1 from public.members m where m.group_id = v_id and private.member_balance(m.id) <> 0
    );

    update public.groups set deleted_at = null, updated_at = v_now where id = v_id;
    insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, after, created_at)
    values (gen_random_uuid(), v_id, 'group', v_id, 'restore', null,
            jsonb_build_object('reason', 'GROUP_HAS_BALANCES'), v_now);

    select coalesce(jsonb_agg(a.value), '[]'::jsonb) into v_applied
    from jsonb_array_elements(v_applied) as a(value)
    where not (a.value->>'table' = 'groups' and a.value->>'id' = v_id::text);
    v_rejected := v_rejected || jsonb_build_object('table', 'groups', 'id', v_id, 'code', 'GROUP_HAS_BALANCES');
  end loop;

  return v_result || jsonb_build_object('applied', v_applied, 'rejected', v_rejected);
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';