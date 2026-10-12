// Sends queued push notifications (see 20261015120000_push_notifications.sql).
//
// Called every minute by pg_cron, but only while private.push_outbox has rows, with the shared
// cron secret in `x-cron-secret` (Vault: fx_cron_secret, checked by public.fx_cron_secret_ok).
// Deployed with --no-verify-jwt: the secret, not a user token, is the auth.
//
// The Firebase service-account key lives in Vault (fcm_service_account) and is read through
// public.push_fcm_credentials(), callable only with the service-role key this function has.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { composePush, parsePushEntries } from '../_shared/domain/pushText.ts';

import { getAccessToken, parseServiceAccount, sendFcm } from './fcm.ts';

/** Outbox entries per claim, claims per run: up to 1,500 activities a minute. */
const CLAIM_SIZE = 500;
const MAX_CLAIMS = 3;
const CONCURRENCY = 8;
/** Stop claiming after this long; anything left goes in the next minute's run. */
const TIME_BUDGET_MS = 40_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function secretKey(): string {
  const dictionary = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dictionary) {
    const value = (JSON.parse(dictionary) as Record<string, string | undefined>).default;
    if (value) return value;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No secret key in the function environment');
  return legacy;
}

/** Run `work` over `items` with at most `limit` in flight. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const started = Date.now();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const given = req.headers.get('x-cron-secret');
  if (!given || given.length < 16 || given.length > 256)
    return json(401, { error: 'UNAUTHORIZED' });
  const { data: allowed, error: authError } = await admin.rpc('fx_cron_secret_ok', {
    p_secret: given,
  });
  if (authError) {
    console.error('push-send: secret check failed', authError.code);
    return json(500, { error: 'AUTH_CHECK_FAILED' });
  }
  if (allowed !== true) return json(401, { error: 'UNAUTHORIZED' });

  // Without credentials, leave the outbox alone: entries expire after an hour on their own.
  const { data: credentials, error: credentialsError } = await admin.rpc('push_fcm_credentials');
  if (credentialsError) {
    console.error('push-send: credentials read failed', credentialsError.code);
    return json(500, { error: 'CREDENTIALS_READ_FAILED' });
  }
  const account = parseServiceAccount(typeof credentials === 'string' ? credentials : null);
  if (!account) return json(503, { error: 'FCM_NOT_CONFIGURED' });

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account);
  } catch (e) {
    console.error('push-send:', (e as Error).message);
    return json(502, { error: 'FCM_AUTH_FAILED' });
  }

  let sent = 0;
  let failed = 0;
  let dropped = 0;
  for (let round = 0; round < MAX_CLAIMS && Date.now() - started < TIME_BUDGET_MS; round++) {
    const { data, error } = await admin.rpc('claim_push_notifications', { p_limit: CLAIM_SIZE });
    if (error) {
      console.error('push-send: claim failed', error.code, error.message);
      return json(500, { error: 'CLAIM_FAILED', sent, failed, dropped });
    }
    const entries = parsePushEntries(data);
    if (entries.length === 0) break;

    const outcomes = await pool(entries, CONCURRENCY, (entry) =>
      sendFcm(account, accessToken, entry.token, composePush(entry)),
    );
    const dead = new Set<string>();
    outcomes.forEach((outcome, i) => {
      if (outcome === 'ok') sent++;
      else if (outcome === 'dead') dead.add(entries[i]!.token);
      else failed++;
    });
    if (dead.size > 0) {
      const { data: count, error: dropError } = await admin.rpc('drop_push_devices', {
        p_tokens: [...dead],
      });
      if (dropError) console.error('push-send: drop failed', dropError.code);
      else dropped += typeof count === 'number' ? count : 0;
    }
    // A short claim means the outbox is empty.
    if (!Array.isArray(data) || data.length === 0) break;
  }

  if (failed > 0) console.error(`push-send: ${failed} message(s) failed`);
  return json(200, { sent, failed, dropped });
});
