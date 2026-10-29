# Web app (split.ssoftapp.in)

The browser version of Expense Splitter. Invite links open it when the app isn't installed, and
anyone can use it without installing anything.

## How it's built

| Piece | Where | Notes |
| ----- | ----- | ----- |
| App shell | `web/` (Vite + React + TypeScript) | Its own `package.json` and `node_modules`; the Android build never sees it (Metro `blockList`, root `tsconfig` / ESLint / Jest ignore it). |
| Shared code | `src/domain`, `src/api`, `src/data`, pure helpers in `src/features` | Imported through the same `@/` alias. A planner, split or rounding change ships to both. |
| Platform swaps | `web/src/platform/` | `@/lib/supabase` and `@/lib/newId` are aliased to browser versions (`vite.config.ts`, `web/tsconfig.json`). |
| Cache + queue | `web/src/platform/persistence.ts` | IndexedDB, write-behind (the store's interface is synchronous). |
| Wiring | `web/src/platform/data.ts` | Same as `src/data/native.ts`: online/offline and tab visibility instead of NetInfo and AppState. |
| Accounts | `web/src/platform/auth.ts` | Same model as the app. Google via Google Identity Services (ID token, no redirect). |
| Hosting | Cloudflare Pages, root directory `web` | `web/public/_headers` sets the CSP and caching. No `404.html`, so Pages serves `index.html` for every route (SPA mode). |

Guard rails:

- Anything from `react-native`, `expo-*`, `@react-native*` or `drizzle-orm` in the web import graph
  fails the build and names the importer (`forbidNativeImports` in `vite.config.ts`). Shared code must
  stay platform-free; type-only imports are fine.
- `npm run check` runs the web typecheck and production build too (`web:check`), and so does CI.
  The typecheck reads the shared code's own types, so it needs the root `npm install` as well (always
  there in the Codespace and CI). Cloudflare only runs the build, which needs `web/` alone.

### Decisions

- **Vite app instead of Expo web.** Expo web would reuse the screens but ship react-native-web and
  stubs for every native module. Invite recipients often open the link once, on mobile data, so the
  first load matters more than reusing screens. The logic is shared; only the UI is written twice.
  First load is about 160 KB gzipped (React 62, supabase-js 55, app 37), and the screens you don't
  open aren't downloaded.
- **wouter** for routing (2 KB) rather than React Router.
- **No account until it's needed.** Opening the site creates nothing. The anonymous account is made
  when the visitor creates or joins a group. Link previews and crawlers never add users, and those
  users count toward the 50,000 MAU free limit.
- **Google sign-in uses GIS ID tokens**, exactly like the app's Credential Manager flow
  (`linkIdentity` / `signInWithIdToken` with a nonce). This avoids the OAuth redirect, which would show
  `cudmaszrwrbgwsoizajd.supabase.co` on Google's consent screen (a custom auth domain is paid). It
  also needs no client secret, and merging an anonymous account works without carrying a token
  across a redirect.
- **Not in the first web version**: bills in another currency, receipt photos, repeating expenses,
  group settings, budgets, insights and payment-details editing. Editing an expense that already has
  a foreign amount, a receipt or a rule keeps those as they are.

### Security and privacy

- The session is in localStorage, so XSS would mean account takeover. Mitigations:
  - CSP: scripts only from this site and `accounts.google.com/gsi/client`; network only to this Supabase project and GIS.
  - No inline scripts or styles.
  - React escaping everywhere, and no `dangerouslySetInnerHTML`.
- Invite codes are dropped from the address bar once read. `Referrer-Policy: no-referrer` keeps them
  out of `Referer`, and `/join` is `noindex`.
- Shared computers: an anonymous account lives in that browser. The Account screen says to save the
  account and sign out. Sign-out wipes IndexedDB and local settings, then reloads.
- UPI from the web:
  - On phones, the `upi://pay` link opens the UPI app chooser. On computers, the same link is shown as a QR code.
  - Nothing is recorded until the person taps **Record payment**.
  - The payee's VPA is validated before the link is built, which blocks parameter injection from a synced value.

### Edge cases

- **Offline:**
  - New expenses, payments and groups queue in IndexedDB and send on reconnect or the next visit.
  - Edits and deletes say "You're offline".
  - Without IndexedDB (some private windows), nothing queues and offline adds are refused.
- **Two tabs** share the queue. Each may send a queued op once more, which is harmless because the
  server answers a repeated request id with its stored result.
- **Background tabs** close their Realtime channels and refetch when they become visible.
- **Money** is integer minor units end to end, with the same planner and rounding as the server
  (largest remainder: ₹1,000 / 3 = ₹333.34 + ₹333.33 + ₹333.33).
- **Lakh/crore grouping** applies when the browser's time zone is India or its locale ends in `-IN`.

## Setup (once)

Paste commands one at a time.

### 1. Allow the web origins in the `api` function

```bash
npx supabase secrets set WEB_ORIGINS="https://split.ssoftapp.in,http://localhost:5173" --project-ref cudmaszrwrbgwsoizajd
```

Testing from a browser-based Codespace (an `https://…-5173.app.github.dev` address)? Add that origin
to the list too, and remove it when done. With VS Code desktop connected to the Codespace, the
forwarded port is plain `http://localhost:5173`.

### 2. Google sign-in on the web

1. Google Cloud console → **APIs & Services** → **Credentials**.
2. Open the **Web client** (the same one as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`).
3. Under **Authorized JavaScript origins**, click **Add URI** for each of these:
   - `https://split.ssoftapp.in`
   - `http://localhost:5173`
   - `http://localhost`
4. Click **Save**. Changes can take a few minutes to apply.
5. Put the client ID in `web/.env` as `VITE_GOOGLE_WEB_CLIENT_ID=` and commit it (it's public).

Supabase needs nothing new: the Google provider already accepts this client ID for the app's ID
tokens.

### 3. Cloudflare Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick `SwapnilMeshram19/expense_splitter` and click **Begin setup**.
3. Fill in the build settings:
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory (under **Advanced**): `web`
   - Environment variable: `NODE_VERSION` = `22`
4. Click **Save and Deploy**. Builds install only `web/`'s dependencies, not the Expo app's.
5. Project → **Settings** → **Build** → **Build watch paths** → **Include paths**: `web/*`, `src/*`.
   This stops app-only commits from using builds (free plan: 500 builds a month).

### 4. Move split.ssoftapp.in from GitHub Pages

1. Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter `split.ssoftapp.in` and click **Continue**. Cloudflare offers to replace the existing DNS
   record (the CNAME to GitHub Pages). Click **Activate domain**.
3. In the GitHub repository that served the old invite page: **Settings** → **Pages** → remove the
   custom domain, so GitHub stops claiming it.
4. Check:
   - `https://split.ssoftapp.in/join/?code=ABCD-EFGH` shows "That code doesn't work".
   - `https://split.ssoftapp.in/privacy/` loads.

### 5. Android App Links (after Play App Signing is set up)

`web/public/.well-known/assetlinks.json`. Get the SHA-256 values from:

- **Play Console** → **Test and release** → **App integrity** → **App signing key certificate**, for the release app.
- The dev keystore, for the dev app.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app", "package_name": "in.ssoftapp.split", "sha256_cert_fingerprints": ["AA:BB:…"] }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app", "package_name": "in.ssoftapp.split.dev", "sha256_cert_fingerprints": ["CC:DD:…"] }
  }
]
```

Until it exists, invite links open the web page. On Android, its **Open in the app** button opens the
app if installed, or the Play Store otherwise.

## Troubleshooting

| What you see | Cause | Fix |
| ------------ | ----- | --- |
| Red banner "Can’t reach the server" while online | Usually CORS: the page's origin isn't in `WEB_ORIGINS`. In dev the console names the origin to add. | Add the exact origin (scheme + host + port) to the secret. |
| Red banner about creating an account | Anonymous sign-ins are off, or the 30/h per-IP limit was hit | Supabase → Authentication → Sign In / Providers. |
| "1 change waiting to send" that never clears | One of the two above: the change is kept and retried every 20 s | Fix the cause; it sends on its own, or tap **Retry now**. |

## Running it

```bash
npm run web:install   # once (and after web/package.json changes)
npm run web:dev       # http://localhost:5173
npm run web:check     # typecheck + production build
```

## Free-tier notes

| Item | Limit | Notes |
| ---- | ----- | ----- |
| Cloudflare Pages | Unlimited requests and bandwidth; 500 builds/month | Build watch paths keep builds to web-relevant commits. |
| Edge Function calls | 500,000/month, shared with the app | One per save (queued adds go in one batch). |
| Auth MAU | 50,000 | Web visitors only count once they create or join a group. The nightly cleanup removes idle anonymous users with no group. |
| Anonymous sign-ins | 30 per hour per IP | Indian mobile networks put many users behind one IP (CGNAT), so watch **Authentication → Users** after launch. If real users hit it, raise the limit (free) in the dashboard's rate limits rather than adding captcha. |
| Realtime | Concurrent connections | One socket per visible tab, closed when the tab is hidden. |
