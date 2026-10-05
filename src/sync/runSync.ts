import type { RepoContext } from '@/db/context';
import { groups } from '@/db/schema';

import { applyPull, applyPushResult, collectPushBatch, getSyncCursor } from './engine';
import { clearRefetchGroupIds, getRefetchGroupIds } from './issueActions';
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

/**
 * One sync cycle: push everything pending, pull changes, then full-fetch groups this phone has
 * never seen plus groups queued for a refetch (discarded local changes).
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

  const first = await transport.pull(getSyncCursor(ctx), []);
  let stats = applyPull(ctx, first);
  report.pulled += stats.written;
  report.conflicts += stats.conflicts;

  const local = new Set(ctx.db.select({ id: groups.id }).from(groups).all().map((g) => g.id));
  const visible = new Set(first.group_ids);
  const unseen = first.group_ids.filter((id) => !local.has(id));
  const refetch = getRefetchGroupIds(ctx).filter((id) => visible.has(id));
  const full = [...new Set([...unseen, ...refetch])].slice(0, MAX_FULL_FETCH_GROUPS);

  if (full.length > 0) {
    const fetched = await transport.pull(first.cursor, full);
    stats = applyPull(ctx, fetched);
    report.pulled += stats.written;
    report.conflicts += stats.conflicts;
  }

  // Refetch requests for groups that are done, or no longer visible, are settled either way.
  clearRefetchGroupIds(ctx, [...full, ...getRefetchGroupIds(ctx).filter((id) => !visible.has(id))]);

  return report;
}