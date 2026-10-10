/**
 * "Something changed in this group" signals, sent by the sync-push Edge Function over Supabase
 * Realtime (private broadcast channels) and received by the app, which then pulls.
 *
 * A signal carries no expense data: only an opaque origin id so a phone can ignore the echo of
 * its own push. The data itself still travels through pull_page, under RLS. Shared by the app and
 * the Edge Function (copied by scripts/sync-domain.mjs), so both use the same topic format.
 */

export const GROUP_CHANGED_EVENT = 'changed';

/** Upper bound on groups signalled per push (a normal batch touches one or two). */
export const MAX_SIGNALLED_GROUPS = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORIGIN_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Realtime topic for a group. Lower-case: Postgres prints uuids in lower case (RLS compares text). */
export function groupTopic(groupId: string): string {
  return `group:${groupId.toLowerCase()}`;
}

/** The sending phone's id, as sent in the X-Sync-Origin header. Anything else is dropped. */
export function parseOrigin(value: unknown): string | null {
  return typeof value === 'string' && ORIGIN_RE.test(value) ? value : null;
}

interface BatchRow {
  id?: unknown;
  group_id?: unknown;
}

export interface SignalBatch {
  groups?: readonly BatchRow[];
  members?: readonly BatchRow[];
  expenses?: readonly BatchRow[];
  settlements?: readonly BatchRow[];
  recurring_rules?: readonly BatchRow[];
}

export interface AppliedRow {
  table?: unknown;
  id?: unknown;
}

const SIGNAL_TABLES = ['groups', 'members', 'expenses', 'settlements', 'recurring_rules'] as const;

/**
 * Groups that really changed in a push: those owning at least one applied row. Rows that were
 * rejected or conflicted change nothing on the server, so they send no signal. Ids come back
 * lower-cased, de-duplicated, in batch order, capped at `limit`.
 */
export function changedGroupIds(
  batch: SignalBatch,
  applied: readonly AppliedRow[],
  limit: number = MAX_SIGNALLED_GROUPS,
): string[] {
  const groupOf = new Map<string, string>();
  for (const table of SIGNAL_TABLES) {
    for (const row of batch[table] ?? []) {
      const id = row.id;
      const groupId = table === 'groups' ? row.id : row.group_id;
      if (typeof id === 'string' && typeof groupId === 'string' && UUID_RE.test(groupId)) {
        groupOf.set(`${table}:${id.toLowerCase()}`, groupId.toLowerCase());
      }
    }
  }

  const result: string[] = [];
  for (const row of applied) {
    if (typeof row.table !== 'string' || typeof row.id !== 'string') continue;
    const groupId = groupOf.get(`${row.table}:${row.id.toLowerCase()}`);
    if (groupId && !result.includes(groupId)) {
      result.push(groupId);
      if (result.length >= limit) break;
    }
  }
  return result;
}
