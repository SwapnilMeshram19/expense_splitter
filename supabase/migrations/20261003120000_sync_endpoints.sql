-- Phase 3.3a · Sync endpoints.
--
-- Push: app → sync-push Edge Function (verifies the user; re-validates expense math with the
--       shared src/domain code) → public.apply_push (service_role only), one transaction.
-- Pull: app → public.pull_changes (authenticated; RLS decides what is visible).
--
-- Wire format is snake_case, matching the columns. Every syncable row carries base_version:
-- the server version the client last saw (0 = never synced). Per row the result is one of
-- applied / conflict / rejected, so one bad row never blocks the rest of a batch.

-- ── Helpers ────────────────────────────────────────────────────────────

create function private.is_active_member(p_user uuid, p_group uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.group_id = p_group and m.user_id = p_user and m.deleted_at is null
  );
$$;

-- Any member of the group, including removed ones (old expenses may keep people who left).
create function private.member_in_group(p_member uuid, p_group uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.members m where m.id = p_member and m.group_id = p_group);
$$;

revoke execute on function private.is_active_member(uuid, uuid) from public;
revoke execute on function private.member_in_group(uuid, uuid) from public;
grant execute on function private.is_active_member(uuid, uuid) to service_role;
grant execute on function private.member_in_group(uuid, uuid) to service_role;

-- ── Push ───────────────────────────────────────────────────────────────

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  v_id uuid;
  v_group uuid;
  v_exists boolean;
  v_cur_group uuid;
  v_cur_version integer;
  v_cur_user uuid;
  v_version integer;
  v_new_groups uuid[] := '{}';
  v_applied jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if p_user is null or jsonb_typeof(p_batch) is distinct from 'object' then
    raise exception 'apply_push: p_user and an object batch are required' using errcode = '22023';
  end if;

  -- Order matters for foreign keys: groups → members → expenses → settlements → activity.

  -- ── Groups ──
  for r in select value from jsonb_array_elements(coalesce(p_batch->'groups', '[]'::jsonb))
  loop
    begin
      v_id := (r->>'id')::uuid;
      select g.version into v_cur_version from public.groups g where g.id = v_id for update;
      v_exists := found;

      if not v_exists then
        -- A new group is accepted only if this same batch makes the caller an active member.
        if not exists (
          select 1 from jsonb_array_elements(coalesce(p_batch->'members', '[]'::jsonb)) m
          where lower(m.value->>'group_id') = v_id::text
            and lower(m.value->>'user_id') = p_user::text
            and m.value->>'deleted_at' is null
        ) then
          v_rejected := v_rejected || jsonb_build_object('table', 'groups', 'id', v_id, 'code', 'NOT_A_MEMBER');
          continue;
        end if;
        insert into public.groups (id, name, simplify_debts, created_at, updated_at, deleted_at)
        values (v_id, r->>'name', coalesce((r->>'simplify_debts')::boolean, true),
                (r->>'created_at')::bigint, (r->>'updated_at')::bigint, (r->>'deleted_at')::bigint)
        returning version into v_version;
        v_new_groups := v_new_groups || v_id;
      elsif not private.is_active_member(p_user, v_id) then
        v_rejected := v_rejected || jsonb_build_object('table', 'groups', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      elsif v_cur_version is distinct from (r->>'base_version')::integer then
        v_conflicts := v_conflicts || jsonb_build_object('table', 'groups', 'id', v_id, 'server_version', v_cur_version);
        continue;
      else
        update public.groups
        set name = r->>'name',
            simplify_debts = coalesce((r->>'simplify_debts')::boolean, true),
            updated_at = (r->>'updated_at')::bigint,
            deleted_at = (r->>'deleted_at')::bigint
        where id = v_id
        returning version into v_version;
      end if;

      v_applied := v_applied || jsonb_build_object('table', 'groups', 'id', v_id, 'version', v_version);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object('table', 'groups', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
    end;
  end loop;

  -- ── Members ──
  for r in select value from jsonb_array_elements(coalesce(p_batch->'members', '[]'::jsonb))
  loop
    begin
      v_id := (r->>'id')::uuid;
      v_group := (r->>'group_id')::uuid;
      select m.group_id, m.version, m.user_id into v_cur_group, v_cur_version, v_cur_user
      from public.members m where m.id = v_id for update;
      v_exists := found;

      -- Same answer for "not your group" and "id belongs to someone else's group": no existence leak.
      if (v_exists and v_cur_group <> v_group)
         or not (v_group = any(v_new_groups) or private.is_active_member(p_user, v_group)) then
        v_rejected := v_rejected || jsonb_build_object('table', 'members', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      end if;

      if not v_exists then
        -- Only yourself or a placeholder. Linking other accounts happens through invites (3.4).
        if r->>'user_id' is not null and lower(r->>'user_id') <> p_user::text then
          v_rejected := v_rejected || jsonb_build_object('table', 'members', 'id', v_id, 'code', 'USER_ID_NOT_ALLOWED');
          continue;
        end if;
        insert into public.members (id, group_id, display_name, user_id, upi_vpa, created_at, updated_at, deleted_at)
        values (v_id, v_group, r->>'display_name', (r->>'user_id')::uuid, r->>'upi_vpa',
                (r->>'created_at')::bigint, (r->>'updated_at')::bigint, (r->>'deleted_at')::bigint)
        returning version into v_version;
      elsif (r->>'user_id')::uuid is distinct from v_cur_user then
        v_rejected := v_rejected || jsonb_build_object('table', 'members', 'id', v_id, 'code', 'USER_ID_IMMUTABLE');
        continue;
      elsif v_cur_version is distinct from (r->>'base_version')::integer then
        v_conflicts := v_conflicts || jsonb_build_object('table', 'members', 'id', v_id, 'server_version', v_cur_version);
        continue;
      else
        update public.members
        set display_name = r->>'display_name',
            upi_vpa = r->>'upi_vpa',
            updated_at = (r->>'updated_at')::bigint,
            deleted_at = (r->>'deleted_at')::bigint
        where id = v_id
        returning version into v_version;
      end if;

      v_applied := v_applied || jsonb_build_object('table', 'members', 'id', v_id, 'version', v_version);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object('table', 'members', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
    end;
  end loop;

  -- ── Expenses (math already validated by the Edge Function with src/domain) ──
  for r in select value from jsonb_array_elements(coalesce(p_batch->'expenses', '[]'::jsonb))
  loop
    begin
      v_id := (r->>'id')::uuid;
      v_group := (r->>'group_id')::uuid;
      select e.group_id, e.version into v_cur_group, v_cur_version
      from public.expenses e where e.id = v_id for update;
      v_exists := found;

      if (v_exists and v_cur_group <> v_group)
         or not (v_group = any(v_new_groups) or private.is_active_member(p_user, v_group)) then
        v_rejected := v_rejected || jsonb_build_object('table', 'expenses', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      end if;
      if v_exists and v_cur_version is distinct from (r->>'base_version')::integer then
        v_conflicts := v_conflicts || jsonb_build_object('table', 'expenses', 'id', v_id, 'server_version', v_cur_version);
        continue;
      end if;
      if not private.member_in_group((r->>'created_by_member_id')::uuid, v_group)
         or exists (
           select 1
           from jsonb_array_elements(coalesce(r->'payers', '[]'::jsonb) || coalesce(r->'shares', '[]'::jsonb)) l
           where not private.member_in_group((l.value->>'member_id')::uuid, v_group)
         ) then
        v_rejected := v_rejected || jsonb_build_object('table', 'expenses', 'id', v_id, 'code', 'UNKNOWN_MEMBER');
        continue;
      end if;

      if v_exists then
        update public.expenses
        set description = r->>'description',
            amount_paise = (r->>'amount_paise')::bigint,
            category = coalesce(r->>'category', 'general'),
            expense_date = (r->>'expense_date')::date,
            split_input = r->'split_input',
            updated_at = (r->>'updated_at')::bigint,
            deleted_at = (r->>'deleted_at')::bigint
        where id = v_id
        returning version into v_version;
        delete from public.expense_payers where expense_id = v_id;
        delete from public.expense_shares where expense_id = v_id;
      else
        insert into public.expenses (id, group_id, description, amount_paise, category, expense_date,
                                     split_input, created_by_member_id, created_at, updated_at, deleted_at)
        values (v_id, v_group, r->>'description', (r->>'amount_paise')::bigint,
                coalesce(r->>'category', 'general'), (r->>'expense_date')::date, r->'split_input',
                (r->>'created_by_member_id')::uuid, (r->>'created_at')::bigint,
                (r->>'updated_at')::bigint, (r->>'deleted_at')::bigint)
        returning version into v_version;
      end if;

      insert into public.expense_payers (expense_id, member_id, amount_paise)
      select v_id, (l.value->>'member_id')::uuid, (l.value->>'amount_paise')::bigint
      from jsonb_array_elements(coalesce(r->'payers', '[]'::jsonb)) l;
      insert into public.expense_shares (expense_id, member_id, amount_paise)
      select v_id, (l.value->>'member_id')::uuid, (l.value->>'amount_paise')::bigint
      from jsonb_array_elements(coalesce(r->'shares', '[]'::jsonb)) l;

      v_applied := v_applied || jsonb_build_object('table', 'expenses', 'id', v_id, 'version', v_version);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object('table', 'expenses', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
    end;
  end loop;

  -- ── Settlements ──
  for r in select value from jsonb_array_elements(coalesce(p_batch->'settlements', '[]'::jsonb))
  loop
    begin
      v_id := (r->>'id')::uuid;
      v_group := (r->>'group_id')::uuid;
      select s.group_id, s.version into v_cur_group, v_cur_version
      from public.settlements s where s.id = v_id for update;
      v_exists := found;

      if (v_exists and v_cur_group <> v_group)
         or not (v_group = any(v_new_groups) or private.is_active_member(p_user, v_group)) then
        v_rejected := v_rejected || jsonb_build_object('table', 'settlements', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      end if;
      if v_exists and v_cur_version is distinct from (r->>'base_version')::integer then
        v_conflicts := v_conflicts || jsonb_build_object('table', 'settlements', 'id', v_id, 'server_version', v_cur_version);
        continue;
      end if;
      if not (private.member_in_group((r->>'from_member_id')::uuid, v_group)
              and private.member_in_group((r->>'to_member_id')::uuid, v_group)
              and private.member_in_group((r->>'created_by_member_id')::uuid, v_group)) then
        v_rejected := v_rejected || jsonb_build_object('table', 'settlements', 'id', v_id, 'code', 'UNKNOWN_MEMBER');
        continue;
      end if;

      if v_exists then
        update public.settlements
        set from_member_id = (r->>'from_member_id')::uuid,
            to_member_id = (r->>'to_member_id')::uuid,
            amount_paise = (r->>'amount_paise')::bigint,
            method = coalesce(r->>'method', 'upi'),
            note = r->>'note',
            settled_at = (r->>'settled_at')::bigint,
            updated_at = (r->>'updated_at')::bigint,
            deleted_at = (r->>'deleted_at')::bigint
        where id = v_id
        returning version into v_version;
      else
        insert into public.settlements (id, group_id, from_member_id, to_member_id, amount_paise, method,
                                        note, settled_at, created_by_member_id, created_at, updated_at, deleted_at)
        values (v_id, v_group, (r->>'from_member_id')::uuid, (r->>'to_member_id')::uuid,
                (r->>'amount_paise')::bigint, coalesce(r->>'method', 'upi'), r->>'note',
                (r->>'settled_at')::bigint, (r->>'created_by_member_id')::uuid,
                (r->>'created_at')::bigint, (r->>'updated_at')::bigint, (r->>'deleted_at')::bigint)
        returning version into v_version;
      end if;

      v_applied := v_applied || jsonb_build_object('table', 'settlements', 'id', v_id, 'version', v_version);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object('table', 'settlements', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
    end;
  end loop;

  -- ── Activity (append-only; a retried push is acknowledged without a second insert) ──
  for r in select value from jsonb_array_elements(coalesce(p_batch->'activity', '[]'::jsonb))
  loop
    begin
      v_id := (r->>'id')::uuid;
      v_group := (r->>'group_id')::uuid;
      select a.group_id into v_cur_group from public.activity_log a where a.id = v_id;
      v_exists := found;

      if (v_exists and v_cur_group <> v_group)
         or not (v_group = any(v_new_groups) or private.is_active_member(p_user, v_group)) then
        v_rejected := v_rejected || jsonb_build_object('table', 'activity', 'id', v_id, 'code', 'FORBIDDEN');
        continue;
      end if;

      if not v_exists then
        if r->>'actor_member_id' is not null
           and not private.member_in_group((r->>'actor_member_id')::uuid, v_group) then
          v_rejected := v_rejected || jsonb_build_object('table', 'activity', 'id', v_id, 'code', 'UNKNOWN_MEMBER');
          continue;
        end if;
        insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id,
                                         before, after, created_at)
        values (v_id, v_group, r->>'entity_type', (r->>'entity_id')::uuid, r->>'action',
                (r->>'actor_member_id')::uuid, nullif(r->'before', 'null'::jsonb),
                nullif(r->'after', 'null'::jsonb), (r->>'created_at')::bigint);
      end if;

      v_applied := v_applied || jsonb_build_object('table', 'activity', 'id', v_id, 'version', null);
    exception when integrity_constraint_violation or data_exception then
      v_rejected := v_rejected || jsonb_build_object('table', 'activity', 'id', r->>'id', 'code', 'INVALID', 'detail', sqlstate);
    end;
  end loop;

  return jsonb_build_object('applied', v_applied, 'conflicts', v_conflicts, 'rejected', v_rejected);
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

-- ── Pull ───────────────────────────────────────────────────────────────

-- Incremental: rows whose writing transaction is older than every transaction still running
-- (pg_snapshot_xmin), so a slow concurrent push can never be skipped by a later cursor.
-- Full: every row of p_full_group_ids (groups this phone has never seen, e.g. after joining).
-- SECURITY INVOKER: RLS filters everything to the caller's groups.
create function public.pull_changes(p_cursor text default null, p_full_group_ids uuid[] default '{}')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lower xid8 := coalesce(nullif(p_cursor, '')::xid8, '0'::xid8);
  v_upper xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_full uuid[] := coalesce(p_full_group_ids, '{}');
begin
  if cardinality(v_full) > 50 then
    raise exception 'pull_changes: at most 50 groups per full fetch' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'cursor', v_upper::text,
    -- Lets the phone notice groups it has lost access to (removed from the group).
    'group_ids', coalesce((select jsonb_agg(t.id) from private.my_group_ids() as t(id)), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(to_jsonb(g) - 'change_xid' - 'server_updated_at')
      from public.groups g
      where g.id = any(v_full) or (g.change_xid >= v_lower and g.change_xid < v_upper)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) - 'change_xid' - 'server_updated_at')
      from public.members m
      where m.group_id = any(v_full) or (m.change_xid >= v_lower and m.change_xid < v_upper)
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(
        (to_jsonb(e) - 'change_xid' - 'server_updated_at') || jsonb_build_object(
          'payers', coalesce((
            select jsonb_agg(jsonb_build_object('member_id', p.member_id, 'amount_paise', p.amount_paise)
                             order by p.member_id)
            from public.expense_payers p where p.expense_id = e.id
          ), '[]'::jsonb),
          'shares', coalesce((
            select jsonb_agg(jsonb_build_object('member_id', s.member_id, 'amount_paise', s.amount_paise)
                             order by s.member_id)
            from public.expense_shares s where s.expense_id = e.id
          ), '[]'::jsonb)
        )
      )
      from public.expenses e
      where e.group_id = any(v_full) or (e.change_xid >= v_lower and e.change_xid < v_upper)
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(to_jsonb(s) - 'change_xid' - 'server_updated_at')
      from public.settlements s
      where s.group_id = any(v_full) or (s.change_xid >= v_lower and s.change_xid < v_upper)
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(a) - 'change_xid' - 'server_updated_at')
      from public.activity_log a
      where a.group_id = any(v_full) or (a.change_xid >= v_lower and a.change_xid < v_upper)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.pull_changes(text, uuid[]) from public, anon;
grant execute on function public.pull_changes(text, uuid[]) to authenticated;