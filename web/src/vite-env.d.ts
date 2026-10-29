/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Project URL only, e.g. https://<ref>.supabase.co */
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  /** Google OAuth Web client ID (same one the Android app uses). Empty hides Google sign-in. */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  /** Play Store listing for "Open in app" / "Get the app". */
  readonly VITE_PLAY_STORE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Set by the app's babel/Metro; shared code may read it. False in the browser build. */
declare const __DEV__: boolean;
