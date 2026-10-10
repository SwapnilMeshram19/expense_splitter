-- Realtime change signals (before Phase 6.5).
--
-- The sync-push Edge Function broadcasts "changed" on the private channel 'group:<uuid>' after a
-- push applies rows in that group. Phones that are members subscribe and pull when it fires.
-- The broadcast carries no expense data; data still only travels through pull_page under RLS.
--
-- Who may RECEIVE: active members of the group (checked when the phone joins the channel and
-- again whenever it sends a refreshed access token).
-- Who may SEND: nobody but the server. There is deliberately no INSERT policy, so a member can't
-- use the channel to make other phones pull in a loop. The Edge Function sends with the secret
-- key, which bypasses these policies.

-- SECURITY DEFINER for the same reason as my_group_ids(): reads members without RLS recursion.
-- Takes the topic as text and never casts it, so a malformed topic is just "no", not an error.
create function private.can_receive_group_signal(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_topic, '') like 'group:%'
     and exists (
       select 1
       from public.members m
       where m.user_id = (select auth.uid())
         and m.deleted_at is null
         and m.group_id::text = substr(p_topic, 7)
     );
$$;

revoke execute on function private.can_receive_group_signal(text) from public, anon;
grant execute on function private.can_receive_group_signal(text) to authenticated;

create policy "group members receive change signals"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast')
  and private.can_receive_group_signal((select realtime.topic()))
);
