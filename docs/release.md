# Android release

`Actions → Android release → Run workflow` (branch `main`) builds the **production** variant
(`in.ssoftapp.split`) as a signed `.aab`, ready for Play Console. Everything here is free: GitHub
Actions runners and artifact storage on the free plan, no EAS.

## How a release run works

1. Inputs: `version_name` (`1.2.3`) and `version_code` (whole number, greater than every code ever
   uploaded). Each successful run tags the commit `android/<versionCode>`, and the next run refuses a
   code that isn't higher than the last tag.
2. Checks every secret before spending runner minutes: Supabase URL (project URL only),
   publishable key (`sb_publishable_…`), Google web client ID, real AdMob unit IDs (not Google's test
   units), upload cert fingerprint format.
3. `npm run check` (typecheck, lint, tests) must pass.
4. `APP_VARIANT=production`, `APP_VERSION_NAME`, `APP_VERSION_CODE`, `ADMOB_ANDROID_APP_ID` feed
   `app.config.ts`; the run checks the resolved package and version, then prebuilds.
5. Writes `.env.production.local` (public values only) and `google-services.json` (required here; the
   dev workflow only warns).
6. Decodes the upload keystore outside the workspace, checks its SHA-256 against
   `ANDROID_UPLOAD_CERT_SHA256`, builds `bundleRelease` signed via Gradle's
   `android.injected.signing.*` properties (no edits to the generated `android/`).
7. Verifies the `.aab`: signed with the upload key, the JS bundle contains the Supabase host (so
   `.env.production.local` was used). Deletes keystore and env files, uploads the `.aab` as an artifact
   (14 days), pushes the tag.

Upload the artifact to **Play Console → Testing → Internal testing** first, never straight to
production.

## One-time setup

### 1. Upload key (separate from the dev keystore)

With Play App Signing (step f of Phase 6.5), Google holds the real app signing key; this key only
proves uploads come from you. If it's lost or leaks, Play Console can reset it, so it isn't
catastrophic, but keep it out of git and off the Codespace.

```bash
keytool -genkeypair -v -keystore upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000 -storetype PKCS12
keytool -list -v -keystore upload.jks -alias upload | grep SHA256   # → ANDROID_UPLOAD_CERT_SHA256
base64 -w0 upload.jks > upload.jks.b64                              # → ANDROID_UPLOAD_KEYSTORE_BASE64
```

PKCS12 uses one password for the store and the key: put the same value in both password secrets.
Keep `upload.jks` and the password in your password manager plus one offline copy, then delete the
`.b64` file. `*.jks` is gitignored.

### 2. Repository secrets (Settings → Secrets and variables → Actions → Secrets)

| Secret                                 | Value                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `ANDROID_UPLOAD_KEYSTORE_BASE64`       | `upload.jks.b64` contents                                                |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD`     | keystore password                                                        |
| `ANDROID_UPLOAD_KEY_ALIAS`             | `upload`                                                                 |
| `ANDROID_UPLOAD_KEY_PASSWORD`          | key password (same as the store password for PKCS12)                     |
| `ANDROID_UPLOAD_CERT_SHA256`           | `AB:CD:…` from `keytool -list -v`                                        |
| `SUPABASE_URL`                         | already exists (keep-alive); `https://<ref>.supabase.co`, no path        |
| `SUPABASE_PUBLISHABLE_KEY`             | already exists; publishable key (`sb_publishable_…`), never a secret key |
| `GOOGLE_WEB_CLIENT_ID`                 | Google OAuth **Web** client ID, same as in `.env.development.local`      |
| `ADMOB_ANDROID_APP_ID`                 | `ca-app-pub-…~…` (see `docs/ads.md`)                                     |
| `EXPO_PUBLIC_ADMOB_HOME_BANNER_ID`     | `ca-app-pub-…/…`                                                         |
| `EXPO_PUBLIC_ADMOB_ACTIVITY_BANNER_ID` | `ca-app-pub-…/…`                                                         |
| `GOOGLE_SERVICES_JSON`                 | already exists; must include `in.ssoftapp.split` (and `.dev`)            |

Only the keystore, passwords and `GOOGLE_SERVICES_JSON` are truly secret; the rest ship inside the
app. They're secrets anyway so the release config lives in one place.

### 3. Firebase

`GOOGLE_SERVICES_JSON` must list both packages. The original Firebase Android app was registered as
`in.ssoftapp.split`, so it's normally there already; the release run stops with a clear error if not.

## Before the first run

Work through `docs/production-supabase.md` (one project serves both variants): stop automatic
migrations, run the readiness check, clear test data, add `GOOGLE_WEB_CLIENT_ID`.

## First upload: Play Internal testing

1. Play Console → **Create app** ("Expense Splitter", app, free). New apps use **Play App Signing**
   automatically: Google generates the app signing key; your upload key only signs uploads.
2. **Testing → Internal testing → Create new release** → upload the `.aab` from the workflow run.
   Release name = versionName. Add yourself (and up to 100 testers) under **Testers**, by email list.
3. **Test and release → App integrity → App signing**: copy the **app signing key** SHA-1 and SHA-256
   (not the upload key's: Play re-signs what testers install).
4. Google Cloud → **Credentials → Create OAuth client → Android**: package `in.ssoftapp.split`, the
   app signing SHA-1. No rebuild needed: Google matches package + signature at sign-in time.
5. Firebase → Project settings → the `in.ssoftapp.split` app → **Add fingerprint**: the same SHA-1 and
   SHA-256 (keeps FCM and any Google APIs happy with the Play-signed build).
6. Uninstall the old dev-keystore app with package `in.ssoftapp.split` from your phone (it can't be
   updated by the Play build), then install from the internal-testing opt-in link.
7. AdMob → your app → **Link to app store** once Play shows the listing; this starts AdMob's review.
   Until it's approved, expect few or no live ads. Register your phone under **AdMob → Settings →
   Test devices** first, so you see test ads and never click your own live ones.
8. `assetlinks.json` at `https://expense-splitter.ssoftapp.in/.well-known/assetlinks.json` with the app signing
   SHA-256, so invite links open the app directly.

Play asks for the store listing, content rating, Data safety, Ads declaration and target audience
before _production_, but internal testing works with most of that unfinished. `docs/ads.md` has
the ads-related answers.

## Cost

A release run is ~30–40 runner minutes. Private repos get 2,000 free minutes a month, and the dev
build uses the same pool, so releasing weekly with a few dev builds stays well inside it. If the
repo becomes public, minutes are unlimited. Artifacts count against 500 MB of free storage; the
14-day retention keeps that bounded.
