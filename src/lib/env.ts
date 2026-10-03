export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingConfigError';
  }
}

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new MissingConfigError(
      `${name} is missing. Copy .env.example to .env.local and restart Expo with -c.`,
    );
  }
  return value.trim();
}

/**
 * The project base URL only, e.g. https://<ref>.supabase.co.
 * A copied REST endpoint (…/rest/v1/) makes every auth call 404 at the gateway.
 */
function projectUrl(raw: string): string {
  const url = raw.replace(/\/+$/, '');
  if (!/^https:\/\/[^/\s]+$/.test(url)) {
    throw new MissingConfigError(
      'EXPO_PUBLIC_SUPABASE_URL must be the project URL only, like https://<ref>.supabase.co ' +
        '(no /rest/v1 or other path).',
    );
  }
  return url;
}

/**
 * Read lazily so a missing value breaks only sign-in, never the offline app.
 * Expo inlines EXPO_PUBLIC_* only for direct `process.env.NAME` access — no dynamic lookups.
 */
export function getSupabaseConfig(): { url: string; publishableKey: string } {
  return {
    url: projectUrl(required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL)),
    publishableKey: required(
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}

/** The Google OAuth *Web* client ID (the ID token's audience). Not the Android client ID. */
export function getGoogleWebClientId(): string {
  const id = required('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);
  if (!id.endsWith('.apps.googleusercontent.com')) {
    throw new MissingConfigError(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID must be a client ID ending in .apps.googleusercontent.com.',
    );
  }
  return id;
}