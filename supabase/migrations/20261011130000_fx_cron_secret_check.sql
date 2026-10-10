-- fx-refresh checks its x-cron-secret header against Vault (fx_cron_secret), the same secret the
-- pg_cron jobs send. One source of truth: no separate FX_CRON_SECRET Edge Function secret to keep
-- in sync. Only the function's service-role client may call this.
--
-- Both sides are hashed before comparing, so the comparison time doesn't depend on how many
-- leading characters match. Secrets shorter than 16 characters are never accepted.

create function public.fx_cron_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    length(p_secret) >= 16 and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'fx_cron_secret'
        and length(s.decrypted_secret) >= 16
        and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(p_secret, 'sha256')
    ),
    false
  );
$$;

revoke execute on function public.fx_cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.fx_cron_secret_ok(text) to service_role;
