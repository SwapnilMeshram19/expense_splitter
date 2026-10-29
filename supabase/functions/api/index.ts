/**
 * The write API: POST /functions/v1/api with { commands: [{ requestId, op, input }] }.
 *
 * Each command is planned with the shared domain code (src/domain/commands.ts, copied into
 * _shared/domain) against the group as stored, then stored all-or-nothing by public.api_apply.
 * Commands run in order, each in its own transaction, each with its own result, so a queue of
 * offline expenses is one call and one bad item never blocks the rest.
 *
 * The client never sends computed shares or history entries: the server builds both.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { GROUP_CHANGED_EVENT, groupTopic, parseOrigin } from '../_shared/domain/changeSignals.ts';
import {
  commandGroupId,
  isCommandOp,
  isUuid,
  planCommand,
  type Command,
  type CommandOp,
} from '../_shared/domain/commands.ts';
import { snapshotFromWire, type WireGroupSnapshot } from '../_shared/domain/model.ts';
import { corsHeaders } from './cors.ts';

const MAX_BODY_BYTES = 256_000;
const MAX_COMMANDS = 50;

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
// Bypasses RLS: the api_* functions check membership themselves.
const adminClient = createClient(SUPABASE_URL, apiKey('secret'), clientOptions);

export interface CommandRequest {
  requestId: string;
  op: CommandOp | 'account.mergeAnonymous';
  input: unknown;
}

export type CommandResult =
  | { requestId: string; ok: true; versions?: Record<string, number>; rev?: string; groupIds?: string[] }
  | { requestId: string; ok: false; error: { code: string; [k: string]: unknown } };

const failure = (requestId: string, code: string, extra: Record<string, unknown> = {}): CommandResult => ({
  requestId,
  ok: false,
  error: { code, ...extra },
});

/**
 * Tell other phones in the group to refetch. Private broadcast: only active members can subscribe
 * (RLS on realtime.messages); the payload holds no data. Best effort: they also refetch on open.
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
  if (failed > 0) console.error('signal failed', { failed, total: groupIds.length });
}

function inBackground(task: Promise<void>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) runtime.waitUntil(task);
  else void task;
}

async function runCommand(userId: string, req: CommandRequest): Promise<CommandResult> {
  const { requestId } = req;
  const cmd = { op: req.op, input: req.input } as Command;

  // A retry after a lost response: the first answer, never a second write.
  const previous = await adminClient.rpc('api_request_result', { p_user: userId, p_request_id: requestId });
  if (previous.error) return failure(requestId, 'SERVER');
  if (previous.data) return { requestId, ...(previous.data as object) } as CommandResult;

  let groupId: string;
  try {
    groupId = commandGroupId(cmd);
  } catch {
    return failure(requestId, 'INVALID_INPUT');
  }
  if (!isUuid(groupId)) return failure(requestId, 'INVALID_INPUT');

  const state = await adminClient.rpc('api_group_state', { p_user: userId, p_group_id: groupId });
  if (state.error) return failure(requestId, 'SERVER');
  const { exists, snapshot } = state.data as { exists: boolean; snapshot: WireGroupSnapshot | null };
  if (cmd.op === 'group.create' && exists) return failure(requestId, 'ID_TAKEN');

  const plan = planCommand(snapshot ? snapshotFromWire(snapshot) : null, {
    userId,
    now: Date.now(),
    newId: () => crypto.randomUUID(),
  }, cmd);
  if (!plan.ok) return { requestId, ok: false, error: plan.error as { code: string } };

  const { batch, generateRuleId } = plan.plan;
  const rows = batch.groups.length + batch.members.length + batch.expenses.length + batch.settlements.length + batch.recurring_rules.length;
  if (rows === 0) return { requestId, ok: true, versions: {}, rev: snapshot?.rev };

  const applied = await adminClient.rpc('api_apply', {
    p_user: userId,
    p_request_id: requestId,
    p_op: cmd.op,
    p_group_id: groupId,
    p_batch: batch,
    p_generate_rule: generateRuleId ?? null,
  });
  if (applied.error) {
    // Never log request data: rows contain names and amounts.
    console.error('api_apply failed', applied.error.code);
    return failure(requestId, 'SERVER');
  }
  return { requestId, ...(applied.data as object) } as CommandResult;
}

/**
 * "Save your account" when the Google/email already had an account: the app signed in to it and
 * sends the anonymous session's token, which proves it owns the anonymous user being merged.
 */
async function mergeAnonymous(userId: string, isAnonymous: boolean, req: CommandRequest): Promise<CommandResult> {
  const token = (req.input as { anonymousAccessToken?: unknown } | null)?.anonymousAccessToken;
  if (isAnonymous || typeof token !== 'string' || token.length > 8_000) return failure(req.requestId, 'INVALID_INPUT');
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user || !data.user.is_anonymous) return failure(req.requestId, 'NOT_ANONYMOUS');
  if (data.user.id === userId) return failure(req.requestId, 'INVALID_INPUT');

  const merged = await adminClient.rpc('merge_anonymous_user', { p_from: data.user.id, p_to: userId });
  if (merged.error) return failure(req.requestId, 'SERVER');
  const result = merged.data as { status: string; group_ids?: string[] };
  if (result.status !== 'OK') return failure(req.requestId, result.status);

  // Its groups now belong to the saved account: the empty anonymous user goes.
  const deleted = await adminClient.auth.admin.deleteUser(data.user.id);
  if (deleted.error) console.error('anonymous delete failed', deleted.error.status);
  return { requestId: req.requestId, ok: true, groupIds: result.group_ids ?? [] };
}

function parseRequests(body: unknown): CommandRequest[] | null {
  const list = (body as { commands?: unknown } | null)?.commands;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_COMMANDS) return null;
  const seen = new Set<string>();
  const out: CommandRequest[] = [];
  for (const item of list) {
    const c = item as Partial<CommandRequest> | null;
    if (!c || !isUuid(c.requestId) || seen.has(c.requestId.toLowerCase())) return null;
    if (!(isCommandOp(c.op) || c.op === 'account.mergeAnonymous')) return null;
    if (typeof c.input !== 'object' || c.input === null) return null;
    seen.add(c.requestId.toLowerCase());
    out.push({ requestId: c.requestId.toLowerCase(), op: c.op, input: c.input });
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const token = req.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: 'UNAUTHENTICATED' });
  // Asks Auth directly: deleted or banned users are refused even with an unexpired token.
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) return json(401, { error: 'UNAUTHENTICATED' });

  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'PAYLOAD_TOO_LARGE' });
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: 'PAYLOAD_TOO_LARGE' });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'INVALID_JSON' });
  }
  const requests = parseRequests(body);
  if (!requests) return json(400, { error: 'INVALID_COMMANDS' });

  const userId = auth.user.id.toLowerCase();
  const changed = new Set<string>();
  const results: CommandResult[] = [];
  // In order: a queued group.create must land before the expenses added to it.
  for (const request of requests) {
    let result: CommandResult;
    try {
      result =
        request.op === 'account.mergeAnonymous'
          ? await mergeAnonymous(userId, auth.user.is_anonymous === true, request)
          : await runCommand(userId, request);
    } catch (e) {
      console.error('command failed', (e as Error).name);
      result = failure(request.requestId, 'SERVER');
    }
    results.push(result);
    if (result.ok) {
      if (request.op === 'account.mergeAnonymous') result.groupIds?.forEach((g) => changed.add(g));
      else changed.add(commandGroupId({ op: request.op, input: request.input } as Command));
    }
  }

  if (changed.size > 0) inBackground(signalGroups([...changed].slice(0, 20), parseOrigin(req.headers.get('X-Sync-Origin'))));
  return json(200, { results });
});
