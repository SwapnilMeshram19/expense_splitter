import { createClient } from 'npm:@supabase/supabase-js@2';

import { changedGroupIds, GROUP_CHANGED_EVENT, groupTopic, parseOrigin } from '../_shared/domain/changeSignals.ts';
import { checkExpenses, checkGroups, parseBatch } from './batch.ts';

const MAX_BODY_BYTES = 1_000_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** New-style keys (JSON dictionary, "default" entry) first; legacy single-key variables as fallback. */
function apiKey(kind: 'publishable' | 'secret'): string {
  const dictionary = Deno.env.get(kind === 'publishable' ? 'SUPABASE_PUBLISHABLE_KEYS' : 'SUPABASE_SECRET_KEYS');
  if (dictionary) {
    const value = (JSON.parse(dictionary) as Record<string, string | undefined>).default;
    if (value) return value;
  }
  const legacy = Deno.env.get(kind === 'publishable' ? 'SUPABASE_ANON_KEY' : 'SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error(`No ${kind} key in the function environment`);
  return legacy;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const authClient = createClient(SUPABASE_URL, apiKey('publishable'), clientOptions);
// Bypasses RLS: used only to call apply_push, which enforces membership itself.
const adminClient = createClient(SUPABASE_URL, apiKey('secret'), clientOptions);

interface ApplyResult {
  applied: { table?: unknown; id?: unknown }[];
  conflicts: unknown[];
  rejected: unknown[];
}

/**
 * Tell the other phones in each changed group to pull. Private broadcast channels: only active
 * members can subscribe (RLS on realtime.messages), and the payload holds no data, just the
 * sender's origin so it can ignore its own echo. Best effort: a failed signal only means the
 * other phones see the change at their next scheduled sync.
 */
async function signalGroups(groupIds: string[], origin: string | null): Promise<void> {
  const results = await Promise.allSettled(
    groupIds.map(async (groupId) => {
      const channel = adminClient.channel(groupTopic(groupId), { config: { private: true } });
      try {
        await channel.httpSend(GROUP_CHANGED_EVENT, { origin });
      } finally {
        await adminClient.removeChannel(channel);
      }
    }),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  // Counts only: group ids are not secret, but there is no reason to put them in logs.
  if (failed > 0) console.error('signal failed', { failed, total: groupIds.length });
}

/** Run after the response is sent when the runtime allows it, so the push never waits on Realtime. */
function inBackground(task: Promise<void>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
  else void task;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: 'UNAUTHENTICATED' });

  // Asks Auth directly: deleted or banned users are refused even with an unexpired token.
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) return json(401, { error: 'UNAUTHENTICATED' });

  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) {
    return json(413, { error: 'PAYLOAD_TOO_LARGE' });
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: 'PAYLOAD_TOO_LARGE' });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'INVALID_JSON' });
  }

  const parsed = parseBatch(body);
  if (!parsed.ok) return json(400, { error: parsed.error });
  const groupsChecked = checkGroups(parsed.batch);
  const { batch, rejected: expenseRejections } = checkExpenses(groupsChecked.batch);
  const rejected = [...groupsChecked.rejected, ...expenseRejections];

  const { data, error } = await adminClient.rpc('apply_push', { p_user: auth.user.id, p_batch: batch });
  if (error) {
    // Never log request data: rows contain names and amounts.
    console.error('apply_push failed', error.code);
    return json(500, { error: 'APPLY_FAILED' });
  }

  const result = data as ApplyResult;
  const changed = changedGroupIds(batch, result.applied);
  if (changed.length > 0) {
    inBackground(signalGroups(changed, parseOrigin(req.headers.get('X-Sync-Origin'))));
  }

  return json(200, {
    applied: result.applied,
    conflicts: result.conflicts,
    rejected: [...rejected, ...result.rejected],
  });
});