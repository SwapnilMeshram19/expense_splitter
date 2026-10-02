export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingConfigError';
  }
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new MissingConfigError(
      `${name} is missing. Copy .env.example to .env.local and restart Expo with -c.`,
    );
  }
  return value;
}

/**
 * Read lazily so a missing value breaks only sign-in, never the offline app.
 * Expo inlines EXPO_PUBLIC_* only for direct `process.env.NAME` access — no dynamic lookups.
 */
export function getSupabaseConfig(): { url: string; publishableKey: string } {
  return {
    url: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
    publishableKey: required(
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ),
  };
}