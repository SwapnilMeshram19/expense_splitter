# Ads (AdMob): setup and rules

Library: `react-native-google-mobile-ads` (pinned; native, needs a dev build after changes).
Everything here is free. AdMob pays out once earnings pass the payment threshold.

## Placement rules (do not change without discussing)

- One inline banner on **Home**, below the groups, only once the user has a real group.
- One inline banner inside **Activity**, after the 8th entry, only when the list has 12+ entries.
- **Never** on add/edit expense, Pay, Settle, Request, Join, invite or any form.
- **No** interstitials, app-open or rewarded ads.
- Family-safe content only (`maxAdContentRating: PG`).
- Banners render nothing until consent allows ads, take no space until an ad arrives, and vanish on
  failure (offline, no fill). They are never hidden with opacity or clipping (invalid traffic).

Code: `src/features/ads/adPolicy.ts` (rules, tested), `adsRuntime.ts` (consent + init),
`AdSlot.tsx` (the banner card).

## Development builds

Always Google's test app ID and test ad units, whatever the env says. Tapping test ads is safe.
Never put real unit IDs in a dev build: clicks on your own live ads get the account suspended.

## One-time AdMob setup (for production)

1. **AdMob → Apps → Add app → Android**, "not yet published" for now, name "Expense Splitter".
   Link it to the Play listing (`in.ssoftapp.split`) after the first release.
   Copy the **App ID** (`ca-app-pub-…~…`).
2. **Ad units → Banner**, two units: `Home banner` and `Activity banner`. Copy both unit IDs
   (`ca-app-pub-…/…`).
3. **Privacy & messaging → European regulations (GDPR)**: create a message for the app (default
   options; add the privacy policy URL `https://split.ssoftapp.in/privacy`) and publish it. Without
   it, EEA/UK users get no ads at all.
4. **app-ads.txt**: AdMob shows a line like
   `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`. Serve it at
   `https://ssoftapp.in/app-ads.txt` (the developer website on the Play listing) once it's live.
5. **GitHub → Settings → Secrets and variables → Actions** (used by the release workflow):
   - `ADMOB_ANDROID_APP_ID`: the App ID (config time: the production build fails without it).
   - `EXPO_PUBLIC_ADMOB_HOME_BANNER_ID`, `EXPO_PUBLIC_ADMOB_ACTIVITY_BANNER_ID`: the unit IDs
     (bundled into the JS). Missing or malformed → no ads in that slot, never a crash.
     None of these are secret (they ship inside the APK), but keeping them with the other release
     values keeps the release workflow in one place.

## Play Console

- **App content → Ads**: "Yes, my app contains ads".
- **Data safety**: the Google Mobile Ads SDK collects device identifiers (advertising ID), approximate
  location from IP and app interactions for advertising and fraud prevention; shared with Google.
  The SDK adds the `AD_ID` permission automatically.
- **Target audience**: not designed for children (keeps the Families policy out of scope).

## Checking it works (dev build)

- Fresh install → only the example group → no ad anywhere.
- Create a real group → a "Sponsored" test banner appears below the groups on Home.
- Activity with 12+ entries → one test banner after the 8th.
- Airplane mode → no empty box, no errors.
- EEA test: in `adsRuntime.ts`, temporarily pass
  `{ debugGeography: AdsConsentDebugGeography.EEA, testDeviceIdentifiers: ['<hash from logcat>'] }`
  to `gatherConsent` → the consent form appears and Account shows "Ad privacy choices".
