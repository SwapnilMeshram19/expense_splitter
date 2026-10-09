-- Phase 6.3 · Paged pull.
--
-- pull_changes returns everything in one response, which can time out on slow networks for big
-- groups. pull_page returns at most p_limit rows per call plus `more`, walking a keyset over
-- (table order, change_xid, id). The first page fixes the window's upper bound; later pages carry
-- it in the cursor, so all pages of one pass read the same window:
--   'p2:<lower>:<upper>:<table ord>:<change_xid>:<id>'   mid-pass
--   '<upper>'                                             pass complete (same format as pull_changes)
-- Rows changed while paging get a newer change_xid (>= upper) and arrive in the next sync.
-- Table order groups → members → expenses → settlements → activity: parents before children.
--
-- pull_changes stays for older app versions.

create function public.pull_page(
  p_cursor text default null,
  p_full_group_ids uuid[] default '{}',
  p_limit integer default 300
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_full uuid[] := coalesce(p_full_group_ids, '{}');
  v_limit integer := least(greatest(coalesce(p_limit, 300), 1), 1000);
  v_lower xid8;
  v_upper xid8;
  v_ord integer := -1;
  v_xid xid8 := '0'::xid8;
  v_id uuid := '00000000-0000-0000-0000-000000000000';
  v_keys jsonb;
  v_more boolean;
  v_last jsonb;
  v_cursor text;
  v_g uuid[];
  v_m uuid[];
  v_e uuid[];
  v_s uuid[];
  v_a uuid[];
begin
  if cardinality(v_full) > 50 then
    raise exception 'pull_page: at most 50 groups per full fetch' using errcode = '22023';
  end if;

  if p_cursor like 'p2:%' then
    if p_cursor !~ '^p2:[0-9]+:[0-9]+:[0-4]:[0-9]+:[0-9a-fA-F-]{36}$' then
      raise exception 'pull_page: invalid cursor' using errcode = '22023';
    end if;
    v_lower := split_part(p_cursor, ':', 2)::xid8;
    v_upper := split_part(p_cursor, ':', 3)::xid8;
    v_ord := split_part(p_cursor, ':', 4)::integer;
    v_xid := split_part(p_cursor, ':', 5)::xid8;
    v_id := split_part(p_cursor, ':', 6)::uuid;
  elsif coalesce(p_cursor, '') !~ '^[0-9]*$' then
    raise exception 'pull_page: invalid cursor' using errcode = '22023';
  else
    v_lower := coalesce(nullif(p_cursor, '')::xid8, '0'::xid8);
    v_upper := pg_snapshot_xmin(pg_current_snapshot());
  end if;

  -- The next page of keys. SECURITY INVOKER: RLS limits everything to the caller's groups.
  select coalesce(jsonb_agg(jsonb_build_object('o', k.ord, 'x', k.x::text, 'i', k.id)
                            order by k.ord, k.x, k.id), '[]'::jsonb)
  into v_keys
  from (
    select ord, x, id
    from (
      select 0 as ord, g.change_xid as x, g.id from public.groups g
      where g.id = any(v_full) or (g.change_xid >= v_lower and g.change_xid < v_upper)
      union all
      select 1, m.change_xid, m.id from public.members m
      where m.group_id = any(v_full) or (m.change_xid >= v_lower and m.change_xid < v_upper)
      union all
      select 2, e.change_xid, e.id from public.expenses e
      where e.group_id = any(v_full) or (e.change_xid >= v_lower and e.change_xid < v_upper)
      union all
      select 3, s.change_xid, s.id from public.settlements s
      where s.group_id = any(v_full) or (s.change_xid >= v_lower and s.change_xid < v_upper)
      union all
      select 4, a.change_xid, a.id from public.activity_log a
      where a.group_id = any(v_full) or (a.change_xid >= v_lower and a.change_xid < v_upper)
    ) candidates
    where (ord, x, id) > (v_ord, v_xid, v_id)
    order by ord, x, id
    limit v_limit + 1
  ) k;

  v_more := jsonb_array_length(v_keys) > v_limit;
  if v_more then
    v_keys := v_keys - v_limit; -- drop the probe row
    v_last := v_keys -> (v_limit - 1);
    v_cursor := format('p2:%s:%s:%s:%s:%s', v_lower, v_upper, v_last->>'o', v_last->>'x', v_last->>'i');
  else
    v_cursor := v_upper::text;
  end if;

  select
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 0), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 1), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 2), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 3), '{}'),
    coalesce(array_agg((k->>'i')::uuid) filter (where (k->>'o')::int = 4), '{}')
  into v_g, v_m, v_e, v_s, v_a
  from jsonb_array_elements(v_keys) k;

  return jsonb_build_object(
    'cursor', v_cursor,
    'more', v_more,
    -- Lets the phone notice groups it has lost access to (removed from the group).
    'group_ids', coalesce((select jsonb_agg(t.id) from private.my_group_ids() as t(id)), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(to_jsonb(g) - 'change_xid' - 'server_updated_at' order by g.change_xid, g.id)
      from public.groups g where g.id = any(v_g)
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(to_jsonb(m) - 'change_xid' - 'server_updated_at' order by m.change_xid, m.id)
      from public.members m where m.id = any(v_m)
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
        order by e.change_xid, e.id
      )
      from public.expenses e where e.id = any(v_e)
    ), '[]'::jsonb),
    'settlements', coalesce((
      select jsonb_agg(to_jsonb(s) - 'change_xid' - 'server_updated_at' order by s.change_xid, s.id)
      from public.settlements s where s.id = any(v_s)
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(a) - 'change_xid' - 'server_updated_at' order by a.change_xid, a.id)
      from public.activity_log a where a.id = any(v_a)
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.pull_page(text, uuid[], integer) from public, anon;
grant execute on function public.pull_page(text, uuid[], integer) to authenticated;

notify pgrst, 'reload schema';