-- Phase 3.1 · Server schema. Mirrors src/db/schema.ts (local SQLite).
--
-- Conventions (same as the app):
--   * Money: integer paise (bigint). Never numeric/float.
--   * Client timestamps: UTC epoch ms (bigint), copied verbatim from the device.
--   * Calendar dates: `date` ('YYYY-MM-DD' on the wire).
--   * Syncable rows are never hard-deleted: deleted_at tombstones.
--   * Server-only columns: version (bumped by trigger), change_xid (pull cursor),
--     server_updated_at (audit). The local `dirty` flag never reaches the server.
--   * expense_payers / expense_shares are only ever rewritten together with their
--     expense, so the expense's version/change_xid covers them.
--
-- Keep CHECK lists in sync with src/db/schema.ts (EXPENSE_CATEGORIES etc.).
-- Name caps assume MAX_NAME_LENGTH <= 100.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ── Trigger functions ──────────────────────────────────────────────────

create function private.touch_versioned_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.change_xid := pg_current_xact_id();
  new.server_updated_at := now();
  return new;
end;
$$;

create function private.forbid_group_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.group_id <> old.group_id then
    raise exception '%.group_id cannot change', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create function private.activity_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.change_xid := pg_current_xact_id();
    new.server_updated_at := now();
    return new;
  end if;
  raise exception 'activity_log is append-only'
    using errcode = 'check_violation';
end;
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Profiles (one per auth user) ───────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_check check (length(trim(display_name)) between 1 and 100)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Must never fail: an exception here aborts the sign-up itself.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Me'
      ),
      100
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ── Groups ─────────────────────────────────────────────────────────────

create table public.groups (
  id uuid primary key,
  name text not null,
  simplify_debts boolean not null default true,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  version integer not null default 0,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  constraint groups_name_check check (length(trim(name)) between 1 and 100)
);

create trigger groups_touch
  before insert or update on public.groups
  for each row execute function private.touch_versioned_row();

-- ── Members ────────────────────────────────────────────────────────────

create table public.members (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  display_name text not null,
  -- null = placeholder (e.g. "Mom"). Account deletion detaches, never deletes money.
  user_id uuid references auth.users (id) on delete set null,
  upi_vpa text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  version integer not null default 0,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  constraint members_name_check check (length(trim(display_name)) between 1 and 100),
  -- Loose on purpose; Phase 4 tightens VPA validation in src/domain first.
  constraint members_upi_vpa_check check (
    upi_vpa is null or (length(upi_vpa) <= 255 and position('@' in upi_vpa) > 1)
  )
);

-- Same semantics as local: NULLs are distinct, so any number of placeholders.
-- Includes removed members: rejoining restores the old row (keeps history).
create unique index members_group_user_uq on public.members (group_id, user_id);
create index members_group_change_idx on public.members (group_id, change_xid);
create index members_user_active_idx on public.members (user_id, group_id)
  where deleted_at is null and user_id is not null;

create trigger members_touch
  before insert or update on public.members
  for each row execute function private.touch_versioned_row();
create trigger members_group_immutable
  before update on public.members
  for each row execute function private.forbid_group_change();

-- ── Expenses ───────────────────────────────────────────────────────────

create table public.expenses (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  description text not null,
  amount_paise bigint not null,
  category text not null default 'general',
  expense_date date not null,
  split_input jsonb not null,
  created_by_member_id uuid not null references public.members (id),
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  version integer not null default 0,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  -- ₹100 crore ceiling: far inside Number.MAX_SAFE_INTEGER, blocks absurd input.
  constraint expenses_amount_check check (amount_paise > 0 and amount_paise <= 10000000000),
  constraint expenses_description_check check (length(description) <= 500),
  constraint expenses_category_check check (category in (
    'general', 'food', 'groceries', 'travel', 'transport',
    'stay', 'shopping', 'utilities', 'entertainment', 'other'
  )),
  constraint expenses_split_input_check check (
    jsonb_typeof(split_input) = 'object' and octet_length(split_input::text) <= 32768
  )
);

create index expenses_group_change_idx on public.expenses (group_id, change_xid);

create trigger expenses_touch
  before insert or update on public.expenses
  for each row execute function private.touch_versioned_row();
create trigger expenses_group_immutable
  before update on public.expenses
  for each row execute function private.forbid_group_change();

create table public.expense_payers (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.members (id),
  amount_paise bigint not null,
  primary key (expense_id, member_id),
  constraint expense_payers_amount_check check (amount_paise >= 0 and amount_paise <= 10000000000)
);

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  member_id uuid not null references public.members (id),
  amount_paise bigint not null,
  primary key (expense_id, member_id),
  constraint expense_shares_amount_check check (amount_paise >= 0 and amount_paise <= 10000000000)
);

-- ── Settlements ────────────────────────────────────────────────────────

create table public.settlements (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  from_member_id uuid not null references public.members (id),
  to_member_id uuid not null references public.members (id),
  amount_paise bigint not null,
  method text not null default 'upi',
  note text,
  settled_at bigint not null,
  created_by_member_id uuid not null references public.members (id),
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint,
  version integer not null default 0,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  constraint settlements_amount_check check (amount_paise > 0 and amount_paise <= 10000000000),
  constraint settlements_not_self check (from_member_id <> to_member_id),
  constraint settlements_method_check check (method in ('upi', 'cash', 'other')),
  constraint settlements_note_check check (note is null or length(note) <= 500)
);

create index settlements_group_change_idx on public.settlements (group_id, change_xid);

create trigger settlements_touch
  before insert or update on public.settlements
  for each row execute function private.touch_versioned_row();
create trigger settlements_group_immutable
  before update on public.settlements
  for each row execute function private.forbid_group_change();

-- ── Activity log (append-only) ─────────────────────────────────────────

create table public.activity_log (
  id uuid primary key,
  group_id uuid not null references public.groups (id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  actor_member_id uuid references public.members (id),
  before jsonb,
  after jsonb,
  created_at bigint not null,
  change_xid xid8 not null default pg_current_xact_id(),
  server_updated_at timestamptz not null default now(),
  constraint activity_entity_type_check check (entity_type in ('group', 'member', 'expense', 'settlement')),
  constraint activity_action_check check (action in ('create', 'update', 'delete', 'restore')),
  constraint activity_before_size check (before is null or octet_length(before::text) <= 16384),
  constraint activity_after_size check (after is null or octet_length(after::text) <= 16384)
);

create index activity_group_change_idx on public.activity_log (group_id, change_xid);

create trigger activity_append_only
  before insert or update or delete on public.activity_log
  for each row execute function private.activity_append_only();