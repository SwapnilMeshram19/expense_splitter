-- Production (or dev) readiness check. Paste into Dashboard → SQL Editor and run after
-- `npm run db:push:<target>` and the Vault step of docs/production-supabase.md.
-- Read-only. Every row should say ok = true; `detail` says what to fix. Secret values are never
-- shown, only the hosts of the function URLs so you can see they point at THIS project.
-- If the query fails on "schema cron does not exist", migrations haven't been applied yet.

with
  secrets as (select name, decrypted_secret as value from vault.decrypted_secrets),
  fx_url as (select value from secrets where name = 'fx_refresh_url'),
  push_url as (select value from secrets where name = 'push_send_url')
select check_name, ok, detail
from (
  select 1 as n, 'migrations applied' as check_name,
         exists (select 1 from supabase_migrations.schema_migrations) as ok,
         'latest: ' || coalesce((select max(version) from supabase_migrations.schema_migrations), 'none')
           || ' (should match the newest file in supabase/migrations)' as detail

  union all
  select 2, 'extensions pg_cron, pg_net, pgcrypto',
         (select count(*) = 3 from pg_extension where extname in ('pg_cron', 'pg_net', 'pgcrypto')),
         'present: ' || coalesce((select string_agg(extname, ', ' order by extname) from pg_extension
                                  where extname in ('pg_cron', 'pg_net', 'pgcrypto')), 'none')

  union all
  select 3, 'vault fx_cron_secret (32+ chars)',
         exists (select 1 from secrets where name = 'fx_cron_secret' and length(value) >= 32),
         'generate with: openssl rand -hex 32'

  union all
  select 4, 'vault fx_refresh_url',
         exists (select 1 from fx_url
                 where value ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/fx-refresh$'),
         coalesce('host: ' || (select split_part(value, '/', 3) from fx_url), 'missing')

  union all
  select 5, 'vault push_send_url',
         exists (select 1 from push_url
                 where value ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/push-send$'),
         coalesce('host: ' || (select split_part(value, '/', 3) from push_url), 'missing')

  union all
  select 6, 'both function URLs on the same project',
         coalesce((select split_part(f.value, '/', 3) = split_part(p.value, '/', 3)
                   from fx_url f, push_url p), false),
         'must be this project''s host (Settings → API → Project URL)'

  union all
  select 7, 'vault fcm_service_account (service-account JSON)',
         exists (select 1 from secrets
                 where name = 'fcm_service_account'
                   and value ~ '"type"\s*:\s*"service_account"'
                   and value ~ '"client_email"\s*:'
                   and value ~ '"private_key"\s*:'),
         'Firebase → Project settings → Service accounts → Generate new private key'

  union all
  select 8, 'cron jobs scheduled and active',
         (select count(*) = 4 from cron.job
          where active and jobname in ('fx-refresh-am', 'fx-refresh-pm', 'push-send', 'recurring-occurrences')),
         'active: ' || coalesce((select string_agg(jobname, ', ' order by jobname) from cron.job where active), 'none')

  union all
  select 9, 'no failed cron runs in the last 24 h',
         not exists (select 1 from cron.job_run_details
                     where status = 'failed' and start_time > now() - interval '1 day'),
         (select count(*) from cron.job_run_details
          where status = 'failed' and start_time > now() - interval '1 day')::text
           || ' failed (cron.job_run_details has the messages)'

  union all
  select 10, 'storage bucket receipts is private',
         exists (select 1 from storage.buckets where id = 'receipts' and not public),
         'created by migration 20261012120000_notes_receipts'

  union all
  select 11, 'keep-alive target public.ping()',
         exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                 where s.nspname = 'public' and p.proname = 'ping'),
         'used by .github/workflows/keep-alive.yml'
) checks
order by n;
