-- Phase 3.4a · Invites: share a code, preview the group, join (claim a placeholder or join new).
--
-- Codes are 8 characters from an unambiguous 30-letter alphabet (no 0/O, 1/I/L, U), shown as
-- ABCD-EFGH. Only sha256(code) is stored. All entry points are SECURITY DEFINER functions that
-- return { status: ... } instead of raising, so failed guesses stay recorded for rate limiting.

create extension if not exists pgcrypto with schema extensions;

-- ── Tables (no client access: RLS on, no policies, no grants) ─────────────

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id),
  code_hash text not null unique,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses integer not null default 20,
  use_count integer not null default 0,
  revoked_at timestamptz,
  constraint invites_max_uses_check check (max_uses between 1 and 100),
  constraint invites_use_count_check check (use_count >= 0)
);

create index invites_group_active_idx on public.invites (group_id) where revoked_at is null;

alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;

create table private.invite_failures (
  user_id uuid not null,
  failed_at timestamptz not null default now()
);

create index invite_failures_user_idx on private.invite_failures (user_id, failed_at);

-- ── Helpers ────────────────────────────────────────────────────────────

-- Rejection sampling: bytes >= 240 (= 8 × 30) are discarded so every character is equally likely.
create function private.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea;
  code text := '';
  i integer;
  b integer;
begin
  while length(code) < 8 loop
    bytes := extensions.gen_random_bytes(16);
    i := 0;
    while i < 16 and length(code) < 8 loop
      b := get_byte(bytes, i);
      if b < 240 then
        code := code || substr(alphabet, (b % 30) + 1, 1);
      end if;
      i := i + 1;
    end loop;
  end loop;
  return code;
end;
$$;

-- Accept "abcd efgh", "ABCD-EFGH", etc.
create function private.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create function private.is_well_formed_invite_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code ~ '^[2-9A-HJKMNP-TV-Z]{8}$';
$$;

create function private.invite_code_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_code, 'UTF8')), 'hex');
$$;

create function private.invite_rate_limited(p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select count(*) >= 10
  from private.invite_failures f
  where f.user_id = p_user and f.failed_at > now() - interval '10 minutes';
$$;

create function private.record_invite_failure(p_user uuid)
returns void
language sql
set search_path = ''
as $$
  delete from private.invite_failures where failed_at < now() - interval '1 day';
  insert into private.invite_failures (user_id) values (p_user);
$$;

-- null = usable; otherwise the status to report.
create function private.invite_problem(p_invite public.invites, p_group public.groups)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_group.id is null or p_group.deleted_at is not null then 'INVALID'
    when p_invite.revoked_at is not null then 'REVOKED'
    when p_invite.expires_at <= now() then 'EXPIRED'
    when p_invite.use_count >= p_invite.max_uses then 'USED_UP'
  end;
$$;

create function private.active_member_count(p_group uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.members m where m.group_id = p_group and m.deleted_at is null;
$$;

-- ── create_invite ──────────────────────────────────────────────────────

create function public.create_invite(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '7 days';
  v_attempt integer := 0;
begin
  if v_user is null or not private.is_active_member(v_user, p_group_id) then
    return jsonb_build_object('status', 'FORBIDDEN');
  end if;
  if exists (select 1 from public.groups g where g.id = p_group_id and g.deleted_at is not null) then
    return jsonb_build_object('status', 'FORBIDDEN');
  end if;
  if (select count(*) from public.invites i
      where i.group_id = p_group_id and i.revoked_at is null and i.expires_at > now()) >= 20 then
    return jsonb_build_object('status', 'TOO_MANY_INVITES');
  end if;

  loop
    v_code := private.new_invite_code();
    begin
      insert into public.invites (group_id, code_hash, created_by, expires_at)
      values (p_group_id, private.invite_code_hash(v_code), v_user, v_expires);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  return jsonb_build_object(
    'status', 'OK',
    'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4),
    'expires_at', v_expires,
    'max_uses', 20
  );
end;
$$;

-- ── revoke_all_invites ─────────────────────────────────────────────────

create function public.revoke_all_invites(p_group_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null or not private.is_active_member(v_user, p_group_id) then
    return jsonb_build_object('status', 'FORBIDDEN');
  end if;
  update public.invites set revoked_at = now()
  where group_id = p_group_id and revoked_at is null;
  get diagnostics v_count = row_count;
  return jsonb_build_object('status', 'OK', 'revoked', v_count);
end;
$$;

-- ── preview_invite ─────────────────────────────────────────────────────

create function public.preview_invite(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text := private.normalize_invite_code(p_code);
  v_invite public.invites;
  v_group public.groups;
  v_problem text;
begin
  if v_user is null then return jsonb_build_object('status', 'UNAUTHENTICATED'); end if;
  if private.invite_rate_limited(v_user) then return jsonb_build_object('status', 'RATE_LIMITED'); end if;
  -- Malformed input is a typo, not a guess: rejected without counting toward the limit.
  if not private.is_well_formed_invite_code(v_code) then return jsonb_build_object('status', 'INVALID'); end if;

  select * into v_invite from public.invites i where i.code_hash = private.invite_code_hash(v_code);
  if not found then
    perform private.record_invite_failure(v_user);
    return jsonb_build_object('status', 'INVALID');
  end if;

  select * into v_group from public.groups g where g.id = v_invite.group_id;
  v_problem := private.invite_problem(v_invite, v_group);
  if v_problem is not null then return jsonb_build_object('status', v_problem); end if;

  if private.is_active_member(v_user, v_group.id) then
    return jsonb_build_object('status', 'ALREADY_MEMBER', 'group_id', v_group.id, 'group_name', v_group.name);
  end if;

  return jsonb_build_object(
    'status', 'OK',
    'group_id', v_group.id,
    'group_name', v_group.name,
    'member_count', private.active_member_count(v_group.id),
    -- Only what is needed to choose "who am I": unclaimed placeholder names. No amounts.
    'placeholders', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'display_name', m.display_name) order by m.display_name)
      from public.members m
      where m.group_id = v_group.id and m.user_id is null and m.deleted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

-- ── join_group ─────────────────────────────────────────────────────────

create function public.join_group(
  p_code text,
  p_claim_member_id uuid default null,
  p_display_name text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code text := private.normalize_invite_code(p_code);
  v_invite public.invites;
  v_group public.groups;
  v_problem text;
  v_existing public.members;
  v_had_row boolean;
  v_target public.members;
  v_member_id uuid;
  v_name text;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_user is null then return jsonb_build_object('status', 'UNAUTHENTICATED'); end if;
  if private.invite_rate_limited(v_user) then return jsonb_build_object('status', 'RATE_LIMITED'); end if;
  if not private.is_well_formed_invite_code(v_code) then return jsonb_build_object('status', 'INVALID'); end if;

  -- Row lock: concurrent joins on one invite are serialized, so use_count can't overshoot.
  select * into v_invite from public.invites i where i.code_hash = private.invite_code_hash(v_code) for update;
  if not found then
    perform private.record_invite_failure(v_user);
    return jsonb_build_object('status', 'INVALID');
  end if;

  select * into v_group from public.groups g where g.id = v_invite.group_id;
  v_problem := private.invite_problem(v_invite, v_group);
  if v_problem is not null then return jsonb_build_object('status', v_problem); end if;

  select * into v_existing from public.members m
  where m.group_id = v_group.id and m.user_id = v_user
  for update;
  v_had_row := found;

  if v_had_row and v_existing.deleted_at is null then
    return jsonb_build_object('status', 'ALREADY_MEMBER', 'group_id', v_group.id, 'member_id', v_existing.id);
  end if;

  if v_had_row then
    -- Removed earlier: restore their own row so their history comes back.
    if private.active_member_count(v_group.id) >= 50 then
      return jsonb_build_object('status', 'GROUP_FULL');
    end if;
    update public.members set deleted_at = null, updated_at = v_now where id = v_existing.id;
    v_member_id := v_existing.id;

  elsif p_claim_member_id is not null then
    -- Lock the placeholder: two people can't claim the same one at the same moment.
    select * into v_target from public.members m
    where m.id = p_claim_member_id and m.group_id = v_group.id
    for update;
    if not found or v_target.deleted_at is not null then
      return jsonb_build_object('status', 'UNKNOWN_MEMBER');
    end if;
    if v_target.user_id is not null then
      return jsonb_build_object('status', 'ALREADY_CLAIMED');
    end if;
    update public.members set user_id = v_user, updated_at = v_now where id = v_target.id;
    v_member_id := v_target.id;

  else
    if private.active_member_count(v_group.id) >= 50 then
      return jsonb_build_object('status', 'GROUP_FULL');
    end if;
    v_name := left(coalesce(
      nullif(trim(p_display_name), ''),
      (select p.display_name from public.profiles p where p.id = v_user),
      'Member'
    ), 100);
    insert into public.members (id, group_id, display_name, user_id, created_at, updated_at)
    values (gen_random_uuid(), v_group.id, v_name, v_user, v_now, v_now)
    returning id into v_member_id;
  end if;

  update public.invites set use_count = use_count + 1 where id = v_invite.id;

  return jsonb_build_object('status', 'JOINED', 'group_id', v_group.id, 'member_id', v_member_id);
end;
$$;

-- ── Grants: signed-in users only ───────────────────────────────────────

revoke execute on function public.create_invite(uuid) from public, anon;
revoke execute on function public.revoke_all_invites(uuid) from public, anon;
revoke execute on function public.preview_invite(text) from public, anon;
revoke execute on function public.join_group(text, uuid, text) from public, anon;

grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.revoke_all_invites(uuid) to authenticated;
grant execute on function public.preview_invite(text) to authenticated;
grant execute on function public.join_group(text, uuid, text) to authenticated;