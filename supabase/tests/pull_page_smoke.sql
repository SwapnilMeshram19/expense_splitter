-- Phase 6.3 smoke test: paged pull. Everything is rolled back.
-- Run: psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/pull_page_smoke.sql
begin;

insert into auth.users (id, email) values ('a7000000-0000-0000-0000-000000000001', 'page-asha@example.test');

insert into public.groups (id, name, created_at, updated_at)
values ('97000000-0000-0000-0000-000000000001', 'Paging', 1, 1);

insert into public.members (id, group_id, display_name, user_id, created_at, updated_at) values
  ('b7000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', 'Asha',
   'a7000000-0000-0000-0000-000000000001', 1, 1),
  ('b7000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Rahul', null, 1, 1);

insert into public.expenses (id, group_id, description, amount_paise, expense_date, split_input,
                             created_by_member_id, created_at, updated_at)
select ('e7000000-0000-0000-0000-00000000000' || n)::uuid, '97000000-0000-0000-0000-000000000001',
       'Item ' || n, 10000, '2026-10-01', '{"type":"equal"}',
       'b7000000-0000-0000-0000-000000000001', 1, 1
from generate_series(1, 3) n;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  g constant uuid := '97000000-0000-0000-0000-000000000001';
  res jsonb;
  v_cursor text := null;
  pages integer := 0;
  ids text[] := '{}';
  page_rows jsonb;
begin
  -- Incremental: rows written by this still-open transaction are never returned (cursor safety).
  res := public.pull_page(null, '{}', 2);
  assert (res->>'more')::boolean = false and jsonb_array_length(res->'expenses') = 0,
    'incremental must not see uncommitted rows: ' || res::text;

  -- Full fetch of 6 rows (1 group, 2 members, 3 expenses) in pages of 2.
  loop
    res := public.pull_page(v_cursor, array[g], 2);
    pages := pages + 1;
    page_rows := res->'groups' || res->'members' || res->'expenses' || res->'settlements' || res->'activity';
    assert jsonb_array_length(page_rows) <= 2, format('page %s too big: %s', pages, page_rows);
    ids := ids || array(select r->>'id' from jsonb_array_elements(page_rows) r);
    v_cursor := res->>'cursor';
    exit when not (res->>'more')::boolean;
    assert v_cursor like 'p2:%', format('mid-pass cursor: %s', v_cursor);
    assert pages < 10, 'too many pages';
  end loop;

  assert pages = 3, format('expected 3 pages, got %s', pages);
  assert cardinality(ids) = 6 and (select count(distinct v) from unnest(ids) v) = 6,
    format('every row exactly once: %s', ids);
  assert v_cursor !~ '^p2:', format('final cursor must be a plain xid8: %s', v_cursor);
  assert res->'group_ids' = jsonb_build_array(g), format('group_ids: %s', res->'group_ids');

  begin
    perform public.pull_page('p2:broken', '{}', 10);
    raise exception 'FAIL: malformed cursor accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Anonymous callers can't pull.
reset role;
set local role anon;
do $$
begin
  begin
    perform public.pull_page(null);
    raise exception 'FAIL: anon can pull';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;

select 'pull_page smoke test passed' as result;