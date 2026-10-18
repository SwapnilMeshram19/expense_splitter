# Production Supabase project: setup checklist

One-time, in this order. Takes about 30 minutes. Everything is on the free plan (limits at the end).
Dev stays exactly as it is; the two projects share nothing except the Firebase project and the
Brevo account.

## 1. Create the project

1. Supabase dashboard → **New project**, same organization as dev.
   - Name `expense-splitter-prod`, region **South Asia (Mumbai)**, Free plan.
   - **Generate a password** and put it in your password manager. You need it for migrations; Supabase
     can reset it but never shows it again.
2. Copy the **project ref** (the `xxxxxxxxxxxxxxxxxxxx` in the dashboard URL) into `PROD_REF` in
   `scripts/supabase-deploy.sh` and commit it. Refs aren't secret: they're in every app's Supabase URL.
3. **Don't connect this project to the GitHub integration.** Dev keeps auto-applying migrations on
   push to `main`; production changes only through `npm run db:push:prod`, after the change has been
   on dev. Check _Project Settings → Integrations → GitHub_ shows nothing connected for prod.

## 2. Migrations

```bash
npx supabase login            # once per Codespace, if functions:deploy hasn't asked before
npm run db:push:prod
```

It asks for the database URL: _Connect_ (top bar) → **Session pooler** → copy, put your password in.
If the password has `@ : / ? #` or `%`, percent-encode them (or reset to a letters-and-digits one).
You see the pending migrations (all of them, the first time), then type the prod ref to apply.

## 3. Vault secrets (SQL Editor)

```sql
-- Cron → Edge Function secret. A NEW value, not dev's: openssl rand -hex 32
select vault.create_secret('<64 hex chars>', 'fx_cron_secret');
select vault.create_secret('https://<prod-ref>.supabase.co/functions/v1/fx-refresh', 'fx_refresh_url');
select vault.create_secret('https://<prod-ref>.supabase.co/functions/v1/push-send', 'push_send_url');
-- Firebase → Project settings → Service accounts → Generate new private key. Use a separate key from
-- dev's, so revoking one never breaks the other. Paste the whole JSON.
select vault.create_secret('<service-account JSON>', 'fcm_service_account');
```

Delete the downloaded service-account JSON afterwards; it can message every user of the app.

## 4. Edge Functions

```bash
npm run functions:deploy:prod   # sync-push, fx-refresh, push-send
```

No function secrets to set: they read the cron secret and FCM key from Vault, and `SUPABASE_URL` /
the secret key are provided by Supabase.

## 5. Auth (Dashboard → Authentication)

| Where                           | Setting                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Sign In / Providers → Email     | Enabled. Email OTP length **6**, expiry **600** s (the app says 10 min)                          |
| Emails → SMTP Settings          | Custom SMTP on, same Brevo SMTP host, login, key and sender as dev                               |
| Emails → Templates → Magic Link | Subject "Your Expense Splitter code", body: `supabase/templates/email-otp.html`                  |
| Rate Limits                     | Emails per hour: 60                                                                              |
| URL Configuration               | Site URL `https://split.ssoftapp.in` (no redirect URLs needed)                                   |
| Sign In / Providers → Google    | Enabled. Client ID: the Google **Web** client ID; its client secret; "Skip nonce checks" **off** |

The Web client can be the same one dev uses: it's only the ID token's audience. What differs per
package is the **Android** client, created in Phase 6.5f with the Play app signing SHA-1.

Without custom SMTP, Supabase's built-in mailer only sends to your own team's addresses, so real
users would never get a code.

## 6. Check it

1. Run `supabase/checks/readiness.sql` in the SQL Editor: every row `ok = true`.
2. Fetch exchange rates now instead of waiting for the next 00:20 / 16:20 UTC run:

   ```sql
   select net.http_post(
     url := (select decrypted_secret from vault.decrypted_secrets where name = 'fx_refresh_url'),
     headers := jsonb_build_object('Content-Type', 'application/json',
       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fx_cron_secret')),
     body := '{}'::jsonb, timeout_milliseconds := 30000);
   -- a few seconds later:
   select count(*) from private.fx_rates;   -- > 0
   ```

## 7. GitHub secrets

_Settings → Secrets and variables → Actions_, used by the release workflow and keep-alive:

- `PROD_SUPABASE_URL`: `https://<prod-ref>.supabase.co` (no path, no trailing slash)
- `PROD_SUPABASE_PUBLISHABLE_KEY`: _Project Settings → API Keys_ → publishable key (`sb_publishable_…`)
- `PROD_GOOGLE_WEB_CLIENT_ID`: the Web client ID from step 5

Then run _Actions → Supabase keep-alive_ once by hand: both `dev` and `prod` should go green.

## Rules from here on

- A migration reaches prod only after it has been on dev (auto-applied on push) and tested on a phone.
  Then: `npm run db:push:prod`, and `npm run functions:deploy:prod` if a function changed.
- Never put the secret key, the DB password or the service-account JSON anywhere in the repo, a
  GitHub secret or an `.env` file. Only the publishable key ships in the app; RLS protects the data.
- Supabase's free plan doesn't give you backups you can restore yourself. Until there are real users
  that's acceptable; before a public launch, add a scheduled `supabase db dump` (free, GitHub Actions).

## Free plan limits that matter (flag before they bite)

| Limit                                   | Why it matters here                                                            | Free way out                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| 2 active free projects per account      | dev + prod use both; another side project needs another account or pausing dev | pause dev when idle                                                       |
| Pauses after 7 days without requests    | covered by keep-alive (Mon & Thu)                                              | —                                                                         |
| 500 MB database                         | text rows are small; thousands of active groups fit                            | archive old activity                                                      |
| 1 GB file storage                       | receipt photos (≤ 1 MB, usually ~150–300 KB): roughly 4,000+ receipts          | stricter compression, or delete receipts of settled groups after N months |
| 5 GB egress / month                     | sync is small; receipt downloads are the main use                              | download receipts only when opened                                        |
| Brevo 300 emails/day, shared dev + prod | each email sign-in is one email; Google sign-in costs none                     | second free Brevo account for prod                                        |
