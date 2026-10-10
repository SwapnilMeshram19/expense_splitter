-- Group budgets (pre-release step 4).
--
-- groups.budget_paise (minor units of the group currency) + budget_period ('total' | 'monthly'),
-- both set or both null. Pushed with the group row; builds that don't send the keys keep the
-- budget. A currency change clears it (the amount was in the old currency), on every path.

alter table public.groups
  add column budget_paise bigint,
  add column budget_period text;

alter table public.groups add constraint groups_budget_check check (
  (budget_paise is null and budget_period is null)
  or (
    budget_paise is not null and budget_period is not null
    and budget_paise > 0 and budget_paise <= 1000000000000
    and budget_period in ('total', 'monthly')
  )
);

-- Runs after groups_currency (triggers fire in name order), so it sees the final currency.
create function private.apply_group_budget()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := nullif(current_setting('app.push_group_budget', true), '')::jsonb;
  v_row jsonb;
begin
  if v_map is not null then
    v_row := v_map -> new.id::text;
    if v_row is not null then
      new.budget_paise := (v_row ->> 'a')::bigint;
      new.budget_period := v_row ->> 'p';
    elsif tg_op = 'UPDATE' then
      new.budget_paise := old.budget_paise; -- builds that don't know budgets
      new.budget_period := old.budget_period;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.currency is distinct from old.currency then
    new.budget_paise := null;
    new.budget_period := null;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_group_budget() from public, anon, authenticated;

create trigger groups_currency_budget
before insert or update on public.groups
for each row execute function private.apply_group_budget();

-- apply_push: publish the budgets carried by group rows, then the existing layers.
alter function public.apply_push(uuid, jsonb) set schema private;
alter function private.apply_push(uuid, jsonb) rename to apply_push_recurring;

revoke execute on function private.apply_push_recurring(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.apply_push_recurring(uuid, jsonb) to service_role;

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_result jsonb;
begin
  -- { "<group id>": { "a": amount | null, "p": period | null } } for rows that carry the key.
  perform set_config('app.push_group_budget', coalesce((
    select jsonb_object_agg(
      lower(r.value->>'id'),
      jsonb_build_object('a', r.value->'budget_paise', 'p', r.value->'budget_period'))
    from jsonb_array_elements(coalesce(p_batch->'groups', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and r.value->>'id' ~ c_uuid
      and r.value ? 'budget_paise'
      and jsonb_typeof(r.value->'budget_paise') in ('number', 'null')
      and jsonb_typeof(coalesce(r.value->'budget_period', 'null'::jsonb)) in ('string', 'null')
  ), '{}'::jsonb)::text, true);

  v_result := private.apply_push_recurring(p_user, p_batch);

  perform set_config('app.push_group_budget', '', true);
  return v_result;
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
