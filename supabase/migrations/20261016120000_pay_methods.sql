-- Payment details beyond UPI (PayPal and other links, IBAN, bank details, Pix, PayNow, PromptPay).
--
-- members.pay_methods: a JSON array, one object per method (src/domain/payMethods.ts). The app
-- validates each method fully; the server checks the shape and size so nobody can store junk or
-- huge blobs, and that links are https only.
--
-- Same ownership rule as upi_vpa: anyone in the group may set a placeholder's details, only the
-- linked account may change its own, and a detached account loses them.
--
-- Travels the same way as budgets and category labels: public.apply_push publishes the values of
-- rows that carry the key, and a BEFORE trigger copies them in. Builds that don't send the key
-- keep what's stored. Same name and signature for apply_push: the Edge Function needs no change.

-- ── 1. Column + shape check ─────────────────────────────────────────────
create function private.valid_pay_methods(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (
    jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) between 1 and 6
    and octet_length(p::text) <= 4000
    and not exists (
      select 1
      from jsonb_array_elements(p) m
      where jsonb_typeof(m) <> 'object'
         or m->>'kind' is null
         or m->>'kind' not in ('link', 'iban', 'bank', 'pix', 'paynow', 'promptpay')
         or (m->>'kind' = 'link' and (m->>'url') !~ '^https://[^/?#@[:space:]]+\.[^/?#@[:space:]]+')
         or exists (
           select 1 from jsonb_each(m) f
           where jsonb_typeof(f.value) <> 'string' or char_length(f.value #>> '{}') > 300
         )
    )
  );
$$;

revoke execute on function private.valid_pay_methods(jsonb) from public, anon, authenticated;
grant execute on function private.valid_pay_methods(jsonb) to service_role;

alter table public.members add column pay_methods jsonb;
alter table public.members add constraint members_pay_methods_check check (private.valid_pay_methods(pay_methods));

-- ── 2. Trigger: apply from the push, enforce ownership ─────────────────
create function private.apply_member_pay_methods()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_map jsonb := nullif(current_setting('app.push_member_pay_methods', true), '')::jsonb;
begin
  if v_map is not null and v_map ? new.id::text then
    new.pay_methods := nullif(v_map -> new.id::text, 'null'::jsonb);
  elsif tg_op = 'UPDATE' then
    new.pay_methods := old.pay_methods; -- builds that don't know payment details
  end if;

  if tg_op = 'UPDATE' then
    -- Account deleted / detached: the details were theirs, they go with them.
    if old.user_id is not null and new.user_id is null then
      new.pay_methods := null;
      return new;
    end if;

    if new.pay_methods is distinct from old.pay_methods
       and old.user_id is not null
       and old.user_id::text is distinct from nullif(current_setting('app.push_user', true), '') then
      -- Same SQLSTATE as the UPI rule: the app already explains it ("only they can change…").
      raise exception 'members.pay_methods: only the linked account can change its payment details'
        using errcode = '23V01';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_member_pay_methods() from public, anon, authenticated;

create trigger members_pay_methods
before insert or update on public.members
for each row execute function private.apply_member_pay_methods();

-- ── 3. apply_push publishes the values, then runs the existing layers ──
alter function public.apply_push(uuid, jsonb) set schema private;
alter function private.apply_push(uuid, jsonb) rename to apply_push_budget;

revoke execute on function private.apply_push_budget(uuid, jsonb) from public, anon, authenticated;
grant execute on function private.apply_push_budget(uuid, jsonb) to service_role;

create function public.apply_push(p_user uuid, p_batch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_result jsonb;
begin
  -- { "<member id>": [ … ] | null } for member rows that carry the key. Wrong types are passed
  -- through and fail the column check for that row only.
  perform set_config('app.push_member_pay_methods', coalesce((
    select jsonb_object_agg(lower(r.value->>'id'), r.value->'pay_methods')
    from jsonb_array_elements(coalesce(p_batch->'members', '[]'::jsonb)) r
    where jsonb_typeof(r.value) = 'object'
      and r.value->>'id' ~ c_uuid
      and r.value ? 'pay_methods'
  ), '{}'::jsonb)::text, true);

  v_result := private.apply_push_budget(p_user, p_batch);

  perform set_config('app.push_member_pay_methods', '', true);
  return v_result;
end;
$$;

revoke execute on function public.apply_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_push(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
