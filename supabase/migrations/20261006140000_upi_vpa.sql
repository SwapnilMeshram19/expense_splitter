-- Phase 4.1 · UPI IDs on members.
--
-- 1. members.upi_vpa: same format as src/domain/upi.ts (VPA_PATTERN), lowercase.
-- 2. Only the linked account may change a claimed member's UPI ID. Placeholders may be set by any
--    active member (apply_push already checks membership). Enforced by a trigger, so it also covers
--    the race "placeholder claimed on the server while another phone edits its UPI ID offline".
-- 3. An account that is detached (auth user deleted → user_id set null) loses its UPI ID.
--
-- apply_push runs as service_role with the caller passed as p_user, so the trigger can't use
-- auth.uid(). public.apply_push becomes a thin wrapper that publishes p_user as a
-- transaction-local setting and calls the unchanged body (moved to private.apply_push_core).
-- Same name and signature: the sync-push Edge Function needs no change.

-- ── 1. Format ──────────────────────────────────────────────────────────
update public.members
set upi_vpa = lower(btrim(upi_vpa))
where upi_vpa is not null and upi_vpa is distinct from lower(btrim(upi_vpa));

alter table public.members drop constraint members_upi_vpa_check;
alter table public.members add constraint members_upi_vpa_check check (
  upi_vpa is null
  or (length(upi_vpa) <= 255 and upi_vpa ~ '^[a-z0-9][a-z0-9._-]*@[a-z][a-z0-9]+$')
);

-- ── 2. Caller identity for triggers ────────────────────────────────────
alter function public.apply_push(uuid, jsonb) set schema private;
alter function private.apply_push(uuid, jsonb) rename to apply_push_core;

revoke execute on function private.apply_push_core(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.apply_push_core(uuid, jsonb) to service_role;

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  -- is_local = true: lives only until the RPC's transaction ends.
  perform set_config('app.push_user', coalesce(p_user::text, ''), true);
  return private.apply_push_core(p_user, p_batch);
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

-- ── 3. Ownership rule ──────────────────────────────────────────────────
create function private.guard_member_vpa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Account deleted / detached: the UPI ID was theirs, it goes with them.
  if old.user_id is not null and new.user_id is null then
    new.upi_vpa := null;
    return new;
  end if;

  if new.upi_vpa is distinct from old.upi_vpa
     and old.user_id is not null
     and old.user_id::text is distinct from nullif(current_setting('app.push_user', true), '') then
    -- Class 23 → apply_push_core's handler turns it into a per-row rejection (detail '23V01').
    raise exception 'members.upi_vpa: only the linked account can change its UPI ID'
      using errcode = '23V01';
  end if;

  return new;
end;
$$;

create trigger members_guard_vpa
  before update on public.members
  for each row execute function private.guard_member_vpa();

notify pgrst, 'reload schema';