-- Phase 3.1 · Access control.
--
-- Clients get SELECT only. All writes go through the sync-push Edge Function (3.3),
-- which validates with src/domain and applies via a SECURITY DEFINER function.
-- RLS is the read gate, and defence in depth if a write grant is ever added by mistake.

-- ── Secure-by-default for objects created by future migrations ─────────
-- Supabase's defaults grant anon/authenticated full access to new public tables.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
-- Functions get EXECUTE for PUBLIC unless revoked globally (per-schema can't remove it).
alter default privileges for role postgres
  revoke execute on functions from public;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema private from public;

-- ── Membership helper ──────────────────────────────────────────────────
-- SECURITY DEFINER: reads members without RLS, avoiding recursive policies.
-- Used as `x in (select private.my_group_ids())` so it runs once per query.
create function private.my_group_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.group_id
  from public.members m
  where m.user_id = (select auth.uid())
    and m.deleted_at is null;
$$;

revoke execute on function private.my_group_ids() from public;
grant execute on function private.my_group_ids() to authenticated;

-- ── Enable RLS everywhere ──────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.members        enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_payers enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements    enable row level security;
alter table public.activity_log   enable row level security;

-- ── Profiles: owner only ───────────────────────────────────────────────
create policy "Own profile is readable" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "Own profile is editable" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;  -- column-level

-- ── Group data: active members only ────────────────────────────────────
create policy "Members read their groups" on public.groups
  for select to authenticated
  using (id in (select private.my_group_ids()));

create policy "Members read group members" on public.members
  for select to authenticated
  using (group_id in (select private.my_group_ids()));

create policy "Members read group expenses" on public.expenses
  for select to authenticated
  using (group_id in (select private.my_group_ids()));

create policy "Members read expense payers" on public.expense_payers
  for select to authenticated
  using (expense_id in (
    select e.id from public.expenses e
    where e.group_id in (select private.my_group_ids())
  ));

create policy "Members read expense shares" on public.expense_shares
  for select to authenticated
  using (expense_id in (
    select e.id from public.expenses e
    where e.group_id in (select private.my_group_ids())
  ));

create policy "Members read group settlements" on public.settlements
  for select to authenticated
  using (group_id in (select private.my_group_ids()));

create policy "Members read group activity" on public.activity_log
  for select to authenticated
  using (group_id in (select private.my_group_ids()));

grant select on
  public.groups, public.members, public.expenses, public.expense_payers,
  public.expense_shares, public.settlements, public.activity_log
to authenticated;

-- ── Keep-alive target (free projects pause after ~7 idle days) ─────────
create function public.ping()
returns integer
language sql
stable
set search_path = ''
as $$ select 1 $$;

grant execute on function public.ping() to anon;