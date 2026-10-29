/**
 * Browser version of src/lib/supabase.ts (swapped in by the `@/lib/supabase` alias), so shared
 * modules such as features/invites/inviteApi.ts work unchanged.
 *
 * The session lives in localStorage (supabase-js default on the web). That makes XSS the main
 * risk: a script injected into the page could read the token. Mitigations live in
 * public/_headers (strict CSP: scripts only from this origin and Google's sign-in) and in the
 * screens (React escaping, no dangerouslySetInnerHTML, user text never used as HTML or URLs).
 *
 * No browser redirects for auth: Google uses an ID token (Google Identity Services), email uses a
 * 6-digit code, so there's nothing to detect in the URL.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingConfigError';
  }
}

function config(): { url: string; key: string } {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!/^https:\/\/[^/\s]+$/.test(url) || !key) {
    throw new MissingConfigError(
      'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are missing. See web/.env.',
    );
  }
  return { url, key };
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const { url, key } = config();
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Separate from any other Supabase app on this origin, and versioned so a future change
      // of format can start clean.
      storageKey: 'es-auth-v1',
    },
  });
  return client;
}
