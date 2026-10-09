import type { RepoContext } from '@/db/context';
import { groups } from '@/db/schema';

import { applyPull, applyPushResult, collectPushBatch, getSyncCursor } from './engine';
import { clearRefetchGroupIds, getRefetchGroupIds, queueRefetchGroupIds } from './issueActions';
import type { PullResult, PushBatch, PushResult } from './wire';

export interface SyncTransport {
  push(batch: PushBatch): Promise<PushResult>;
  pull(cursor: string | null, fullGroupIds: string[]): Promise<PullResult>;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  rejected: number;
}

const MAX_PUSH_ROUNDS = 10;
const MAX_FULL_FETCH_GROUPS = 50;
/** Safety stop for one pass (× page size rows). An incremental pass continues next sync. */
const MAX_PAGES_PER_PASS = 200;

interface PullPass {
  last: PullResult;
  complete: boolean;
}

/**
 * Pull page after page until the server says there is no more.
 * saveEveryPage: incremental passes save their cursor after each page, so an interrupted sync
 * resumes where it stopped. Full fetches save only the final cursor: an interrupted full fetch
 * restarts (its groups stay queued), so a group is never left half-loaded.
 */
async function pullPass(
  ctx: RepoContext,
  transport: SyncTransport,
  start: string | null,
  full: string[],
  saveEveryPage: boolean,
  report: SyncReport,
): Promise<PullPass> {
  let cursor = start;
  let last: PullResult | null = null;
  for (let page = 0; page < MAX_PAGES_PER_PASS; page++) {
    const result = await transport.pull(cursor, full);
    const done = result.more !== true;
    const stats = applyPull(ctx, result, { saveCursor: saveEveryPage || done });
    report.pulled += stats.written;
    report.conflicts += stats.conflicts;
    last = result;
    cursor = result.cursor;
    if (done) return { last, complete: true };
  }
  return { last: last!, complete: false };
}

/**
 * One sync cycle: push everything pending, pull changes (in pages), then full-fetch groups this
 * phone has never seen plus groups queued for a refetch (discarded changes, interrupted fetches).
 */
export async function runSync(ctx: RepoContext, transport: SyncTransport): Promise<SyncReport> {
  const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, rejected: 0 };

  for (let round = 0; round < MAX_PUSH_ROUNDS; round++) {
    const collected = collectPushBatch(ctx);
    if (!collected) break;

    const result = await transport.push(collected.batch);
    applyPushResult(ctx, collected, result);
    report.pushed += result.applied.length;
    report.conflicts += result.conflicts.length;
    report.rejected += result.rejected.length;

    // Rows with issues are excluded from the next batch; stop if a round made no progress.
    if (result.applied.length === 0) break;
  }

  // Taken BEFORE pulling: a newly visible group whose row arrives in the incremental pull
  // (e.g. renamed recently) still needs its full history.
  const localBefore = new Set(ctx.db.select({ id: groups.id }).from(groups).all().map((g) => g.id));

  const incremental = await pullPass(ctx, transport, getSyncCursor(ctx), [], true, report);
  if (!incremental.complete) return report; // very large backlog: the next sync continues

  const visible = new Set(incremental.last.group_ids);
  const unseen = incremental.last.group_ids.filter((id) => !localBefore.has(id));
  // Queued before fetching: if the full fetch is interrupted, the next sync fetches them again.
  queueRefetchGroupIds(ctx, unseen);

  const full = getRefetchGroupIds(ctx)
    .filter((id) => visible.has(id))
    .slice(0, MAX_FULL_FETCH_GROUPS);

  let fetched: string[] = [];
  if (full.length > 0) {
    const pass = await pullPass(ctx, transport, incremental.last.cursor, full, false, report);
    if (pass.complete) fetched = full;
  }

  // Done, or no longer visible (lost access): either way they're settled.
  clearRefetchGroupIds(ctx, [...fetched, ...getRefetchGroupIds(ctx).filter((id) => !visible.has(id))]);

  return report;
}