-- Server-first data layer.
--
-- The server is the only source of truth. Clients no longer push batches of locally edited rows:
-- every change is one command sent to the `api` Edge Function, which plans it with the shared
-- domain code (src/domain/commands.ts) against the group as stored here, then calls
-- public.api_apply() below. Reads come from per-group snapshots (get_group / list_groups) and a
-- paged history (list_activity).
--
-- api_apply reuses public.apply_push (every write rule already lives there and in its triggers),
-- but a command is all or nothing: if any of its rows is refused or was changed by someone else,
-- the whole command is rolled back and reported as one error. Retries are idempotent through
-- private.api_requests.
--
-- sync-push and pull_page stay for app builds from before this change.

-- ── 1. Idempotency ─────────────────────────────────────────────────────

create table private.api_requests (
  user_id uuid not null,
  request_id uuid not null,
  op text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index api_requests_created_idx on private.api_requests (created_at);
revoke all on private.api_requests from public, anon, authenticated;
grant select, insert, update, delete on private.api_requests to service_role;

-- ── 2. Indexes for snapshots and history ───────────────────────────────

create index if not exists recurring_rules_group_change_idx on public.recurring_rules (group_id, change_xid);
create index if not exists activity_group_created_idx on public.activity_log (group_id, created_at desc, id desc);
create index if not exists expenses_rule_idx on public.expenses (recurring_rule_id) where recurring_rule_id is not null;

-- ── 3. Snapshots ───────────────────────────────────────────────────────

-- Changes whenever any row of the group changes (every write bumps change_xid by trigger).
create function private.group_rev(p_group uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    (select g.change_xid from public.groups g where g.id = p_group),
    (select max(m.change_xid) from public.members m where m.group_id = p_group),
    (select max(e.change_xid) from public.expenses e where e.group_id = p_group),
    (select max(s.change_xid) from public.settlements s where s.group_id = p_group),
    (select max(r.change_xid) from public.recurring_rules r where r.group_id = p_group),
    (select max(a.change_xid) from public.activity_log a where a.group_id = p_group)
  )::text;
$$;

-- Wire format (snake_case, like pull_page), with server versions. Deleted expenses, payments and
-- rules are left out; all members are included (old expenses keep naming people who left).
-- No access check here: callers check membership first.
create function private.group_snapshot(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'rev', private.group_rev(g.id),
    'group', to_jsonb(g) - 'change_xid' - 'server_updated_at',
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) - 'change_xid' - 'server_updated_at' order by m.created_at, m.id)
      from public.members m where m.group_id = g.id
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(
        (to_jsonb(e) - 'change_xid' - 'server_updated_at') || jsonb_build_object(
          'payers', coalesce((
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                     'member_id', p.member_id,
                     'amount_paise', p.amount_paise,
                     'original_amount_minor', p.original_amount_minor))
                   order by p.member_id)
            from public.expense_payers p where p.expense_id = e.id
          ), '[]'::jsonb),
          'shares', coalesce((
            select jsonb_agg(jsonb_build_object('member_id', s.member_id, 'amount_paise', s.amount_paise)
                             order by s.member_id)
            from public.expense_shares s where s.expense_id = e.id
          ), '[]'::jsonb))
        order by e.expense_date desc, e.created_at desc, e.id desc)
      from public.expenses e where e.group_id = g.id and e.deleted_at is null
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(to_jsonb(s) - 'change_xid' - 'server_updated_at' order by s.settled_at desc, s.id)
      from public.settlements s where s.group_id = g.id and s.deleted_at is null
    ), '[]'::jsonb),
    'recurring_rules', coalesce((
      select jsonb_agg(to_jsonb(r) - 'change_xid' - 'server_updated_at' order by r.created_at, r.id)
      from public.recurring_rules r where r.group_id = g.id and r.deleted_at is null
    ), '[]'::jsonb),
    -- Same rule as private.locked_group_currency: any row ever, deleted ones included.
    'currency_locked', exists (select 1 from public.expenses e where e.group_id = g.id)
                    or exists (select 1 from public.settlements s where s.group_id = g.id)
                    or exists (select 1 from public.recurring_rules r where r.group_id = g.id),
    'rules_with_occurrences', coalesce((
      select jsonb_agg(distinct e.recurring_rule_id)
      from public.expenses e where e.group_id = g.id and e.recurring_rule_id is not null
    ), '[]'::jsonb)
  )
  from public.groups g
  where g.id = p_group;
$$;

revoke execute on function private.group_rev(uuid) from public;
revoke execute on function private.group_snapshot(uuid) from public;
grant execute on function private.group_rev(uuid) to service_role;
grant execute on function private.group_snapshot(uuid) to service_role;

-- ── 4. Reads for clients ───────────────────────────────────────────────

-- One group. p_known_rev = the rev the client already holds: then only {status:'UNCHANGED'}.
-- Not a member (never were, removed, or the group was deleted): {status:'FORBIDDEN'}, the same
-- answer whether or not the group exists.
create function public.get_group(p_group_id uuid, p_known_rev text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_rev text;
begin
  if v_user is null then return jsonb_build_object('status', 'UNAUTHENTICATED'); end if;
  if not exists (
    select 1 from public.groups g
    where g.id = p_group_id and g.deleted_at is null and private.is_active_member(v_user, g.id)
  ) then
    return jsonb_build_object('status', 'FORBIDDEN');
  end if;

  v_rev := private.group_rev(p_group_id);
  if p_known_rev is not null and p_known_rev = v_rev then
    return jsonb_build_object('status', 'UNCHANGED', 'rev', v_rev);
  end if;
  return jsonb_build_object('status', 'OK', 'snapshot', private.group_snapshot(p_group_id));
end;
$$;

-- Every group I'm an active member of. p_known = { "<group id>": "<rev>" } for what the client
-- already holds: those come back as {id, rev} only. A group missing from the answer is gone for
-- this user (left, removed or deleted).
create function public.list_groups(p_known jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_known jsonb := case when jsonb_typeof(p_known) = 'object' then p_known else '{}'::jsonb end;
begin
  if v_user is null then return jsonb_build_object('status', 'UNAUTHENTICATED'); end if;
  return jsonb_build_object('status', 'OK', 'groups', coalesce((
    select jsonb_agg(
      case when v_known ->> t.id::text = t.rev
        then jsonb_build_object('id', t.id, 'rev', t.rev)
        else jsonb_build_object('id', t.id, 'rev', t.rev, 'snapshot', private.group_snapshot(t.id))
      end
      order by t.updated_at desc)
    from (
      select g.id, g.updated_at, private.group_rev(g.id) as rev
      from public.groups g
      join public.members m on m.group_id = g.id and m.user_id = v_user and m.deleted_at is null
      where g.deleted_at is null
    ) t
  ), '[]'::jsonb));
end;
$$;

-- History, newest first, for one group or all of mine. Keyset paging on (created_at, id):
-- pass the last entry's created_at and id to get the next page.
create function public.list_activity(
  p_group_id uuid default null,
  p_before bigint default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_groups uuid[];
  v_rows jsonb;
begin
  if v_user is null then return jsonb_build_object('status', 'UNAUTHENTICATED'); end if;
  select coalesce(array_agg(m.group_id), '{}') into v_groups
  from public.members m
  join public.groups g on g.id = m.group_id and g.deleted_at is null
  where m.user_id = v_user and m.deleted_at is null
    and (p_group_id is null or m.group_id = p_group_id);
  if p_group_id is not null and cardinality(v_groups) = 0 then
    return jsonb_build_object('status', 'FORBIDDEN');
  end if;

  select coalesce(jsonb_agg(x.row order by x.created_at desc, x.id desc), '[]'::jsonb) into v_rows
  from (
    select to_jsonb(a) - 'change_xid' - 'server_updated_at' as row, a.created_at, a.id
    from public.activity_log a
    where a.group_id = any(v_groups)
      and (p_before is null or (a.created_at, a.id) < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by a.created_at desc, a.id desc
    limit v_limit + 1
  ) x;

  return jsonb_build_object(
    'status', 'OK',
    'activity', case when jsonb_array_length(v_rows) > v_limit then v_rows - v_limit else v_rows end,
    'more', jsonb_array_length(v_rows) > v_limit
  );
end;
$$;

revoke execute on function public.get_group(uuid, text) from public, anon;
revoke execute on function public.list_groups(jsonb) from public, anon;
revoke execute on function public.list_activity(uuid, bigint, uuid, integer) from public, anon;
grant execute on function public.get_group(uuid, text) to authenticated;
grant execute on function public.list_groups(jsonb) to authenticated;
grant execute on function public.list_activity(uuid, bigint, uuid, integer) to authenticated;

-- ── 5. Writes (service role, called by the `api` Edge Function) ────────

-- The group as the planner needs it. snapshot is null unless p_user is an active member of a live
-- group; exists says whether the id is taken at all (group.create must not reuse one).
create function public.api_group_state(p_user uuid, p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exists', exists (select 1 from public.groups g where g.id = p_group_id),
    'snapshot', case
      when exists (select 1 from public.groups g where g.id = p_group_id and g.deleted_at is null)
           and private.is_active_member(p_user, p_group_id)
      then private.group_snapshot(p_group_id)
    end
  );
$$;

-- A previously answered request (retry after a lost response), or null.
create function public.api_request_result(p_user uuid, p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select r.result from private.api_requests r where r.user_id = p_user and r.request_id = p_request_id;
$$;

-- Store one planned command, all or nothing.
-- Returns {ok:true, versions:{"<table>:<id>": version}, rev} or {ok:false, error:{code, detail?}}.
-- The answer is kept for 24 hours under (user, request id): a retry gets the same answer and
-- never applies the command twice.
create function public.api_apply(
  p_user uuid,
  p_request_id uuid,
  p_op text,
  p_group_id uuid,
  p_batch jsonb,
  p_generate_rule uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_failed boolean := false;
  v_out jsonb;
  v_first jsonb;
begin
  if p_user is null or p_request_id is null then
    raise exception 'api_apply: user and request id are required' using errcode = '22023';
  end if;

  -- Claim the request id. A concurrent retry waits here until the first one commits.
  insert into private.api_requests (user_id, request_id, op) values (p_user, p_request_id, p_op)
  on conflict do nothing;
  if not found then
    return coalesce(
      (select r.result from private.api_requests r where r.user_id = p_user and r.request_id = p_request_id),
      jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'IN_PROGRESS')));
  end if;

  begin
    v_result := public.apply_push(p_user, p_batch);
    if jsonb_array_length(coalesce(v_result->'conflicts', '[]')) > 0
       or jsonb_array_length(coalesce(v_result->'rejected', '[]')) > 0 then
      v_failed := true;
      raise exception 'api_apply: command refused' using errcode = 'P0099';
    end if;
    if p_generate_rule is not null then
      perform private.generate_recurring_occurrences(now(), 24, p_generate_rule);
    end if;
  exception when sqlstate 'P0099' then
    -- Everything this block wrote is rolled back; v_result still says why.
    null;
  end;

  if v_failed then
    if jsonb_array_length(coalesce(v_result->'conflicts', '[]')) > 0 then
      v_out := jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'STALE'));
    else
      v_first := v_result->'rejected'->0;
      v_out := jsonb_build_object('ok', false, 'error', jsonb_strip_nulls(jsonb_build_object(
        'code', coalesce(v_first->>'code', 'INVALID'),
        'detail', v_first->>'detail',
        'table', v_first->>'table')));
    end if;
  else
    v_out := jsonb_build_object(
      'ok', true,
      'versions', coalesce((
        select jsonb_object_agg((a->>'table') || ':' || lower(a->>'id'), a->'version')
        from jsonb_array_elements(v_result->'applied') a
        where a->>'table' <> 'activity'
      ), '{}'::jsonb),
      'rev', private.group_rev(p_group_id));
  end if;

  update private.api_requests set result = v_out where user_id = p_user and request_id = p_request_id;
  return v_out;
end;
$$;

revoke execute on function public.api_group_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.api_request_result(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.api_apply(uuid, uuid, text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.api_group_state(uuid, uuid) to service_role;
grant execute on function public.api_request_result(uuid, uuid) to service_role;
grant execute on function public.api_apply(uuid, uuid, text, uuid, jsonb, uuid) to service_role;

-- ── 6. Recurring: generate one rule's due expenses right after it is saved ──

drop function private.generate_recurring_occurrences(timestamptz, integer);

create function private.generate_recurring_occurrences(
  p_now timestamptz default now(),
  p_limit integer default 24,
  p_rule_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_ns constant uuid := '5c1e9a52-4b7d-4f2e-9d0a-3c8b6e2f1a47';
  v_rule public.recurring_rules;
  v_today date;
  v_date date;
  v_id uuid;
  v_made integer;
  v_total integer := 0;
  v_ms bigint := (extract(epoch from p_now) * 1000)::bigint;
  v_groups uuid[] := '{}';
  v_group uuid;
begin
  for v_rule in
    select r.* from public.recurring_rules r
    join public.groups g on g.id = r.group_id
    where r.deleted_at is null and g.deleted_at is null
      and (p_rule_id is null or r.id = p_rule_id)
    order by r.id
  loop
    begin
      v_today := (p_now at time zone v_rule.time_zone)::date;
    exception when others then
      v_today := (p_now at time zone 'UTC')::date; -- unknown zone name: UTC rather than nothing
    end;

    -- Someone on the rule has left (or isn't in the group): wait until the rule is edited.
    if exists (
      select 1 from jsonb_array_elements(v_rule.payers || v_rule.shares) l
      where not exists (
        select 1 from public.members m
        where m.id = (l.value->>'member_id')::uuid and m.group_id = v_rule.group_id and m.deleted_at is null)
    ) then
      continue;
    end if;

    v_made := 0;
    for n in 0..999 loop
      v_date := case v_rule.frequency
        when 'weekly' then v_rule.start_date + 7 * n
        when 'monthly' then (v_rule.start_date + make_interval(months => n))::date
        else (v_rule.start_date + make_interval(years => n))::date
      end;
      exit when v_date > v_today
        or (v_rule.end_date is not null and v_date > v_rule.end_date)
        or v_made >= p_limit;

      v_id := extensions.uuid_generate_v5(c_ns, v_rule.id::text || '/' || to_char(v_date, 'YYYY-MM-DD'));
      -- An existing row (made by a phone, or deleted by someone) is never touched.
      insert into public.expenses (
        id, group_id, description, amount_paise, category, category_label, expense_date,
        split_input, created_by_member_id, created_at, updated_at, deleted_at, note,
        recurring_rule_id, occurrence_date)
      values (
        v_id, v_rule.group_id, v_rule.description, v_rule.amount_paise, v_rule.category,
        v_rule.category_label, v_date, v_rule.split_input, v_rule.created_by_member_id,
        v_ms, v_ms, null, v_rule.note, v_rule.id, v_date)
      on conflict (id) do nothing;

      if found then
        insert into public.expense_payers (expense_id, member_id, amount_paise)
        select v_id, (l.value->>'member_id')::uuid, (l.value->>'amount_paise')::bigint
        from jsonb_array_elements(v_rule.payers) l;
        insert into public.expense_shares (expense_id, member_id, amount_paise)
        select v_id, (l.value->>'member_id')::uuid, (l.value->>'amount_paise')::bigint
        from jsonb_array_elements(v_rule.shares) l;
        insert into public.activity_log (id, group_id, entity_type, entity_id, action, actor_member_id, after, created_at)
        values (
          extensions.uuid_generate_v5(c_ns, v_rule.id::text || '/' || to_char(v_date, 'YYYY-MM-DD') || '/activity'),
          v_rule.group_id, 'expense', v_id, 'create', null,
          jsonb_build_object(
            'description', v_rule.description,
            'amountPaise', v_rule.amount_paise,
            'category', v_rule.category,
            'expenseDate', to_char(v_date, 'YYYY-MM-DD'),
            'payers', (select jsonb_agg(jsonb_build_object('memberId', l.value->>'member_id',
                                                           'amountPaise', (l.value->>'amount_paise')::bigint))
                       from jsonb_array_elements(v_rule.payers) l),
            'shares', (select jsonb_agg(jsonb_build_object('memberId', l.value->>'member_id',
                                                           'amountPaise', (l.value->>'amount_paise')::bigint))
                       from jsonb_array_elements(v_rule.shares) l),
            'recurringRuleId', v_rule.id,
            'frequency', v_rule.frequency),
          v_ms)
        on conflict (id) do nothing;
        v_made := v_made + 1;
        v_total := v_total + 1;
        if not (v_rule.group_id = any(v_groups)) then
          v_groups := v_groups || v_rule.group_id;
        end if;
      end if;
    end loop;
  end loop;

  -- Tell open phones to refetch (same data-free signal as the api function). Best effort.
  foreach v_group in array v_groups loop
    begin
      perform realtime.send(jsonb_build_object('origin', 'server-recurring'), 'changed',
                            'group:' || v_group::text, true);
    exception when others then
      null;
    end;
  end loop;

  return v_total;
end;
$$;

revoke execute on function private.generate_recurring_occurrences(timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function private.generate_recurring_occurrences(timestamptz, integer, uuid) to service_role;

-- ── 7. Anonymous accounts ──────────────────────────────────────────────
-- Every install signs in anonymously (Supabase Auth). "Save your account" links Google or email to
-- the same user. When that Google/email already has an account, the app signs in to it and the
-- api function calls merge_anonymous_user to move the anonymous user's groups across.

create function public.merge_anonymous_user(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved uuid[] := '{}';
  v_kept uuid[] := '{}';
  m public.members;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'merge_anonymous_user: two different users are required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_from and u.is_anonymous) then
    return jsonb_build_object('status', 'NOT_ANONYMOUS');
  end if;
  if not exists (select 1 from auth.users u where u.id = p_to and not u.is_anonymous) then
    return jsonb_build_object('status', 'NO_TARGET');
  end if;

  for m in select * from public.members where user_id = p_from for update loop
    if exists (select 1 from public.members t where t.group_id = m.group_id and t.user_id = p_to) then
      -- Already in that group under the saved account: the anonymous member becomes a placeholder,
      -- keeping its expenses and balance (the guard triggers clear its payment details).
      update public.members set user_id = null, updated_at = (extract(epoch from now()) * 1000)::bigint
      where id = m.id;
      v_kept := v_kept || m.group_id;
    else
      update public.members set user_id = p_to, updated_at = (extract(epoch from now()) * 1000)::bigint
      where id = m.id;
      v_moved := v_moved || m.group_id;
    end if;
  end loop;

  update public.invites set created_by = p_to where created_by = p_from;
  delete from public.push_devices where user_id = p_from;

  return jsonb_build_object('status', 'OK', 'moved', to_jsonb(v_moved), 'placeholders', to_jsonb(v_kept),
                            'group_ids', to_jsonb(v_moved || v_kept));
end;
$$;

revoke execute on function public.merge_anonymous_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous_user(uuid, uuid) to service_role;

-- Supabase has no automatic clean-up of anonymous users. Daily: delete anonymous users older than
-- 30 days, not seen for 30 days, who belong to no group. Their profile and devices cascade.
create function private.cleanup_anonymous_users(p_older_than interval default '30 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.users u
  where u.is_anonymous
    and u.created_at < now() - p_older_than
    and coalesce(u.last_sign_in_at, u.created_at) < now() - p_older_than
    and not exists (select 1 from public.members m where m.user_id = u.id and m.deleted_at is null);
  get diagnostics v_count = row_count;

  delete from private.api_requests where created_at < now() - interval '1 day';
  return v_count;
end;
$$;

revoke execute on function private.cleanup_anonymous_users(interval) from public, anon, authenticated;
grant execute on function private.cleanup_anonymous_users(interval) to service_role;

do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('cleanup-anonymous-users', '41 21 * * *',
                          'select private.cleanup_anonymous_users()');
  end if;
end;
$outer$;

notify pgrst, 'reload schema';
