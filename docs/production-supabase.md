# Supabase: one project for dev builds and the Play Store app

Decision (18 Oct 2026): the existing project (`cudmaszrwrbgwsoizajd`, Mumbai, free) serves both app
variants. No second project: it keeps the second free slot and the setup in one place.

What that means day to day:

- **Every change to the database is live.** There's no staging copy. Migrations go out deliberately,
  after a dry run, never automatically on push.
- **Dev builds use real data.** Test with dedicated test accounts and test groups, and delete them
  when done. Don't experiment with data in the SQL editor on rows that belong to real users.
- **Keys are shared.** The publishable key is in both apps (fine: RLS protects the data). Rotating
  it means a new Play release, so don't rotate it casually.

## Going-live checklist (once, before the first Play upload)

### 1. Stop automatic migrations

Dashboard → _Project Settings → Integrations → GitHub_: turn off automatic migrations (or disconnect
the repository). From now on migrations apply only through:

```bash
npm run db:push     # dry run, shows pending migrations, asks before applying
```

Run it right after pushing a commit that adds a migration, so `main` and the database don't drift.
The DB URL comes from _Connect → Session pooler_, with your DB password (percent-encode `@ : / ? # %`).

To try a risky migration first without touching live data: `npx supabase start` in the Codespace runs a
local copy (Docker, free), then `npx supabase db reset` applies every migration to it.

### 2. Check what's already there

Run `supabase/checks/readiness.sql` in the SQL Editor. Every row should be `ok = true`. The Vault
values, cron jobs and functions were set up during development; the check confirms nothing is missing
or failing.

### 3. Clear test data

Your own real groups can stay. Delete test groups from inside the app first (group settings → delete),
then the test users under _Authentication → Users_. Old test push tokens are removed
automatically the first time FCM rejects them.

### 4. Auth settings

| Where                           | Should be                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| Emails → SMTP Settings          | Custom SMTP on (Brevo). Without it, real users never get a sign-in code |
| Emails → Templates → Magic Link | Body from `supabase/templates/email-otp.html`                           |
| Emails → Templates → Change Email | Body from `supabase/templates/email-change-otp.html` (must show `{{ .Token }}`) |
| Sign In / Providers → Anonymous | **On** (everyone starts with an anonymous account: `docs/server-first.md`) |
| Sign In / Providers → Manual linking | **On** (saving an anonymous account to Google)                     |
| Sign In / Providers → Email     | OTP length 6, expiry 600 s (the app says 10 min)                        |
| Rate Limits                     | Emails per hour: 60; anonymous sign-ins per hour per IP: 30             |
| URL Configuration               | Site URL `https://expense-splitter.ssoftapp.in`                                    |
| Sign In / Providers → Google    | Enabled, the **Web** client ID + secret, "Skip nonce checks" off        |

The Play build needs one more Google **Android** OAuth client (package `in.ssoftapp.split`, Play app
signing SHA-1): `docs/release.md` → First upload.

### 5. GitHub secrets for the release workflow

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` already exist (keep-alive uses them); the release build
reads the same two. Add one more:

- `GOOGLE_WEB_CLIENT_ID`: the same value as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in
  `.env.development.local`.

## Deploying changes

```bash
npm run db:push                          # migrations
npm run functions:deploy                 # all Edge Functions (api, sync-push, fx-refresh, push-send)
npm run functions:deploy -- push-send    # just one
```

Never put the secret key, the DB password or the FCM service-account JSON in the repo, a GitHub
secret or an `.env` file.

## Backups

The free plan doesn't give you backups you can restore yourself, and this project now holds real
users' data. Before a public launch, add a scheduled `supabase db dump` (GitHub Actions, free) that
keeps the last few dumps as private artifacts.

## Free plan limits that matter

| Limit                                | Why it matters here                                    | Free way out                           |
| ------------------------------------ | ------------------------------------------------------ | -------------------------------------- |
| Pauses after 7 days without requests | covered by keep-alive (Mon & Thu)                      | —                                      |
| 500 MB database                      | text rows are small; thousands of active groups fit    | archive old activity                   |
| 1 GB file storage                    | receipt photos (≤ 1 MB, usually ~150–300 KB): ~4,000+  | delete receipts of long-settled groups |
| 5 GB egress / month                  | a refresh sends only groups whose `rev` changed; receipts are the main use | download receipts only when opened     |
| 50,000 monthly active users (Auth)   | anonymous accounts count; ones in no group and idle 30 days are deleted nightly | — (far above expected use)             |
| Brevo 300 emails/day                 | one email per email sign-in; Google sign-in sends none | second free Brevo account              |
