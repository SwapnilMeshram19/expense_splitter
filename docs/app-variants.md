# App variants: development vs production

`app.config.ts` builds one of two apps, chosen by `APP_VARIANT`:

|                                 | development (default)                   | production                               |
| ------------------------------- | --------------------------------------- | ---------------------------------------- |
| Android package / iOS bundle ID | `in.ssoftapp.split.dev`                 | `in.ssoftapp.split`                      |
| Launcher label                  | Split Dev (orange icon)                 | Expense Splitter                         |
| URL scheme                      | `expensesplitter-dev`                   | `expensesplitter`                        |
| Built by                        | Actions → Android dev build (debug APK) | Actions → Android release (signed .aab)  |
| Supabase / Google web client    | same project; `.env.development.local`  | same values from CI secrets              |
| AdMob                           | Google test IDs (always)                | real IDs from CI secrets (`docs/ads.md`) |

Both can be installed side by side: separate local SQLite, separate sign-in, separate push token.
They share one Supabase project (`docs/production-supabase.md`), so dev builds see real data: test with
test accounts and test groups.
Unset `APP_VARIANT` means development, so nothing reaches production by accident; a typo fails the
build. Check what a variant resolves to with `npm run config:dev` / `npm run config:prod`.

Everything below is free.

## One-time setup for the dev package

1. **Google sign-in (Google Cloud → APIs & Services → Credentials).** Android OAuth clients are tied
   to one package + one SHA-1. While nothing is on Play yet, the simplest route: edit the existing
   Android client and change its package to `in.ssoftapp.split.dev` (same dev-keystore SHA-1, printed
   by the dev build workflow). Later, for the store app, create a new Android client for
   `in.ssoftapp.split` with the **Play App Signing** SHA-1. The Web client and Supabase's Google
   provider settings stay as they are.
2. **Firebase (push).** Project settings → Add app → Android → `in.ssoftapp.split.dev`. Download
   `google-services.json` again: the new file contains both apps. Replace the `GOOGLE_SERVICES_JSON`
   repo secret with it. The dev build stops with a clear error if the secret lacks the dev package.
3. **Env file in the Codespace.** `mv .env.local .env.development.local` (same values). Restart with
   `npx expo start -c`.
4. **Invite links (optional).** `https://split.ssoftapp.in/join/…` opens the app without a chooser
   only for packages listed in `https://split.ssoftapp.in/.well-known/assetlinks.json`. Add an entry
   for `in.ssoftapp.split.dev` with the dev SHA-256 if you want that on the dev app too; otherwise
   enable it under Android Settings → Apps → Split Dev → Open by default.

## Moving your phone to the dev app

The old dev APK has package `in.ssoftapp.split` and won't be updated any more.

1. In the old app, open Account and make sure nothing is waiting to sync (example-group changes never
   sync; they're local by design).
2. Run Actions → Android dev build, install **Split Dev**, sign in: your groups come back from Supabase.
3. Uninstall the old "Expense Splitter" app so it can't be confused with the future store build.
