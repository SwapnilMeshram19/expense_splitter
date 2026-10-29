# Server-first data

The app reads and writes through the server. There is no "save locally, sync later" any more,
except a small offline queue for new items.

## How it works

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| Commands | `src/domain/commands.ts` (shared with the server) | 14 ops (`expense.add`, `group.update`, …). `planCommand` checks the input against the group's current state and returns the rows to write. |
| `api` Edge Function | `supabase/functions/api` | `POST { commands: [...] }` (≤ 50, ≤ 256 KB). For each: idempotency check → load group state → `planCommand` → `api_apply` (all-or-nothing, version-checked). Then a Realtime signal to the group. |
| Read RPCs | `supabase/migrations/20261029120000_server_first_api.sql` | `list_groups(p_known)` returns only groups whose `rev` changed; `get_group`; `list_activity` (paged). |
| API client | `src/api/client.ts` | Typed calls; errors as `ApiError` (`OFFLINE`, `UNAUTHENTICATED`, `BAD_REQUEST`, `SERVER`). |
| Data store | `src/data/store.ts` | Holds the server's group snapshots, pending ops and the view (snapshots + pending ops re-planned on top). Plain TypeScript, no React Native: the web app reuses it. |
| Cache | `src/data/sqlitePersistence.ts` (`data-cache.db`) | Last snapshots + the outbox, so the app opens instantly and offline. A cache only: the server is the truth. |
| Hooks | `src/data/hooks.ts` | `useData`, `useDataStatus`, `useActivity`, `runCommand`. React only (works on web). |

### Writing

`runCommand(op, input)`:

1. Plans the command locally against the current view. A validation error comes back at once,
   without a network call.
2. **Queueable ops** (`expense.add`, `settlement.add`, `group.create`): saved to the outbox, shown
   immediately, then sent. Offline, they wait and go out on reconnect, app start or refresh. They
   only add rows with client-made UUIDs, so a late send can't clash with anyone else's edit.
3. **Everything else** (edits, deletes, members, budgets, rules) needs a connection. The screen
   waits for the server and shows "You're offline" instead of queuing. This is deliberate: a
   queued edit could be stale by the time it's sent.
4. Every edit carries `expectedVersion`. If someone else changed the row first the server answers
   `STALE`, the app refetches the group and the user retries on fresh data.

A request id makes each command idempotent: a retry after a dropped response returns the stored
result instead of applying twice (kept for one day).

A queued op the server refuses (e.g. the group was deleted meanwhile) stays visible on the
**Not saved yet** screen (`/pending`) with **Try again** / **Discard**.

### Reading

On app start, focus, pull-to-refresh, reconnect and Realtime signals, the store calls
`list_groups` with the `rev` it already has for each group. Unchanged groups cost a few bytes.
Groups you were removed from disappear.

## Accounts

- First launch signs in **anonymously** (`signInAnonymously`). No screen, no email. Everything
  works, including creating and joining groups.
- **Save your account** (Account tab) keeps it if the phone is lost:
  - Google: `linkIdentity` with the ID token. The same user id, so nothing moves.
  - Email: `updateUser({ email })` + `verifyOtp({ type: 'email_change' })`. Same user id.
  - If that Google account or email already has an account, the app signs in to it and calls
    `account.mergeAnonymous`. The server moves the anonymous user's memberships across, then
    deletes the anonymous user.
- Invites need a saved account (an anonymous user can join, but not invite), so a group never
  depends on an account that might be lost.
- Sign out is only offered for saved accounts and is blocked while items are queued.

### Anonymous abuse and captcha

Supabase recommends captcha for anonymous sign-ins. Turnstile/hCaptcha need a WebView on mobile
and add friction for every new user, so captcha is **off**. Instead:

- the per-IP limit of 30 anonymous sign-ins per hour (`supabase/config.toml`);
- a nightly cron (`cleanup-anonymous-users`, 21:41 UTC) deletes anonymous users who are in no group
  and have not been seen for 30 days;
- RLS is unchanged: an anonymous user only ever sees groups they are a member of.

Revisit if the Auth user count grows unexpectedly (dashboard → Authentication → Users, filter by
anonymous).

## Moving existing installs (one release)

`src/legacy/handover.ts` runs once after sign-in on phones that have data from the old
local-first version: it pushes anything unsent with the old engine (`sync-push`), then wipes the
old tables. Keep the `sync-push` function deployed for at least one release, then remove it, the
`src/legacy` folder and the old repositories (except `profile` and `receipts`).

ESLint (`no-restricted-imports`) stops screens from importing the old repositories or `src/legacy`.

## Setup (once per Supabase project)

1. Dashboard → Authentication → Sign In / Providers: turn on **Anonymous sign-ins** and
   **Manual linking** (already on locally via `supabase/config.toml`).
2. Dashboard → Authentication → Emails → Templates → **Change Email Address**: paste
   `supabase/templates/email-change-otp.html`. It must show `{{ .Token }}`: the app asks for the
   6-digit code, not a link.
3. Edge Function secret for the web app (comma-separated, no trailing slash needed):

   ```bash
   npx supabase secrets set WEB_ORIGINS="https://split.ssoftapp.in,http://localhost:5173" --project-ref cudmaszrwrbgwsoizajd
   ```

   Without it the API sends no CORS headers: the mobile app works, browsers are refused.

## Deploy order

```bash
npm run db:push                       # 1. migration: api_apply, read RPCs, cleanup cron
npm run functions:deploy -- api       # 2. the new function (sync-push stays as is)
# 3. then release the app build / EAS update
```

The old app keeps working against the same database during the rollout: the migration only adds.

## Free-tier notes

- Each command is one Edge Function invocation (free plan: 500,000/month). Batching is built in:
  the outbox sends queued ops in one request.
- A refresh is one `list_groups` call; unchanged groups return nothing, so egress stays small.
- Realtime: one private channel per group (first 20), only while the app is in the foreground and online, as before.
- Anonymous users count toward the 50,000 MAU Auth limit; the cleanup cron keeps that in check.
