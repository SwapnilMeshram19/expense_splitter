import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { createChunkedStorage } from './chunkedStorage';
import { getSupabaseConfig } from './env';

let client: SupabaseClient | null = null;

/**
 * Lazily created so importing this module never touches config or storage.
 * Untyped for now; generated DB types arrive with sync in 3.3.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const { url, publishableKey } = getSupabaseConfig();
  client = createClient(url, publishableKey, {
    auth: {
      storage: createChunkedStorage(SecureStore),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // no browser redirects: OTP codes and native Google tokens only
    },
  });
  return client;
}