-- "Automatically expose new tables" is disabled at the project level, so service_role
-- (used only server-side by the sync-push Edge Function) needs explicit grants.
-- service_role bypasses RLS, but not table privileges.
-- No TRUNCATE: nothing in the app ever needs it, and tombstones mean no hard deletes
-- except cascading payer/share rewrites, which DELETE covers.

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public
  to service_role;

-- Future tables created by migrations (run as postgres) get the same grants.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

-- Functions are granted one by one (e.g. private.apply_push in 3.3), because
-- EXECUTE for PUBLIC is revoked globally in the RLS migration.
