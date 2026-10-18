# Push notifications: one-time setup

Everything here is free (Firebase Cloud Messaging has no per-message charge).

## 1. Firebase project

1. <https://console.firebase.google.com> → **Add project** (Google Analytics: off).
2. **Add app → Android** twice: **`in.ssoftapp.split`** (store app) and **`in.ssoftapp.split.dev`**
   (dev build), names must match exactly. Download `google-services.json` after adding both: one file
   holds both apps (see `docs/app-variants.md`).
3. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `GOOGLE_SERVICES_JSON`, value: the whole file's contents.
     The APK workflow writes it next to `app.config.ts` before building; it is git-ignored.
4. Firebase → **Project settings → Service accounts → Generate new private key**. Keep the JSON
   file private: it can send notifications to every user. Never commit it.

## 2. Supabase

SQL editor (the key goes into Vault, encrypted at rest; nothing secret in migrations):

```sql
select vault.create_secret('<paste the whole service-account JSON>', 'fcm_service_account');
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/push-send', 'push_send_url');
```

`fx_cron_secret` (already set for fx-refresh) is reused as the cron → function secret.

Then apply the migration and deploy the function:

```bash
npx supabase db push --db-url "$DB_URL"
npm run functions:deploy -- push-send   # dev; functions:deploy:prod for production
```

## 3. App

Run **Actions → Android dev build** and install the new APK.

## Checking it works

- Phone A and B signed in, both in a group; B allows notifications.
- A adds an expense that includes B → B gets a notification within about a minute.
- `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'push-send') order by start_time desc limit 5;`
- Edge Function logs (Dashboard → Edge Functions → push-send) show `{ sent, failed, dropped }`.

## Rotating the service-account key

Generate a new key in Firebase, then:

```sql
select vault.update_secret((select id from vault.secrets where name = 'fcm_service_account'), '<new JSON>');
```

and delete the old key in Firebase.
