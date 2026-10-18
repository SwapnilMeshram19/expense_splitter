-- Phase 6.5d · Drop pull_changes.
--
-- The app has synced only through pull_page (paged, same response shape) since 20261009150000, and
-- no store release ever shipped, so no installed app can still call pull_changes. Keeping it would
-- leave a second, unpaged read endpoint to secure and keep in step with every schema change.
--
-- Fresh projects (production) create it in 20261003120000 and drop it here in the same db push.
drop function if exists public.pull_changes(text, uuid[]);

notify pgrst, 'reload schema';
