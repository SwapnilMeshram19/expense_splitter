import type { RepoContext } from '@/db/context';
import {
  deleteReceiptFileRow,
  receiptExpense,
  receiptFilesInState,
  recordReceiptFailure,
  referencedReceiptIds,
  setReceiptState,
} from '@/db/repositories/receipts';
import type { ReceiptFile } from '@/db/schema';
import { receiptObjectPath } from '@/domain/note';

/** What the queue needs from storage and the file system (real ones in receiptStorage.ts). */
export interface ReceiptQueueDeps {
  /** Upload this phone's copy of the photo. */
  upload(path: string, receiptId: string): Promise<UploadOutcome>;
  /** Delete the server copy. Succeeds when there is nothing to delete. */
  remove(path: string): Promise<'ok' | { error: string }>;
  hasLocal(receiptId: string): boolean;
  deleteLocal(receiptId: string): void;
}

export type UploadOutcome =
  /** Stored (or it was already there: a retry after a lost response). */
  | 'ok'
  /** The server refused it: the expense there doesn't point at this photo (yet). */
  | 'denied'
  /** This phone's copy is gone (storage cleared). Nothing left to upload. */
  | 'missingFile'
  | { error: string };

export interface ReceiptQueueReport {
  uploaded: number;
  removed: number;
  failed: number;
}

/** Wait before retrying a failed photo: 1, 5, 15 minutes, then hourly. */
const RETRY_AFTER_MS = [60_000, 300_000, 900_000, 3_600_000];
const retryDue = (row: ReceiptFile, now: number) =>
  row.attempts === 0 ||
  now - row.updatedAt >= RETRY_AFTER_MS[Math.min(row.attempts - 1, RETRY_AFTER_MS.length - 1)]!;

const pathOf = (row: ReceiptFile) => receiptObjectPath(row.groupId, row.expenseId, row.receiptId);

/**
 * One pass over the photos this phone has to upload or clean up. Runs after a successful sync, so
 * the expense rows on the server are as fresh as they get. Order matters for safety:
 * - Upload only once the expense that points at the photo has been pushed (the server's storage
 *   rule checks exactly that).
 * - Delete a replaced photo only once the server no longer points at it (also enforced by the
 *   storage rule), and never while any local expense still does (a conflict review may have
 *   brought the old version back).
 */
export async function runReceiptQueue(
  ctx: RepoContext,
  deps: ReceiptQueueDeps,
): Promise<ReceiptQueueReport> {
  const report: ReceiptQueueReport = { uploaded: 0, removed: 0, failed: 0 };
  const now = () => ctx.now();

  // Clean-ups first: a photo that's back in use goes straight into this pass's uploads.
  const discards = receiptFilesInState(ctx.db, 'discard');
  const stillUsed = referencedReceiptIds(ctx.db, discards.map((r) => r.receiptId));
  for (const row of discards) {
    if (stillUsed.has(row.receiptId)) {
      // Back in use (conflict review kept the old version): upload again if this phone has it.
      if (deps.hasLocal(row.receiptId)) setReceiptState(ctx.db, row.receiptId, 'upload', now());
      else deleteReceiptFileRow(ctx.db, row.receiptId);
      continue;
    }
    const expense = receiptExpense(ctx.db, row.expenseId);
    // The change that dropped the photo must reach the server first, or the delete is refused.
    if (expense && (expense.version === 0 || expense.dirty)) continue;
    if (!retryDue(row, now())) continue;

    const outcome = await deps.remove(pathOf(row));
    if (outcome === 'ok') {
      deps.deleteLocal(row.receiptId);
      deleteReceiptFileRow(ctx.db, row.receiptId);
      report.removed++;
    } else {
      recordReceiptFailure(ctx.db, row.receiptId, outcome.error, now());
      report.failed++;
    }
  }

  for (const row of receiptFilesInState(ctx.db, 'upload')) {
    const expense = receiptExpense(ctx.db, row.expenseId);
    if (!expense) {
      // The expense left this phone (group deleted here): nothing will ever point at the photo.
      deps.deleteLocal(row.receiptId);
      deleteReceiptFileRow(ctx.db, row.receiptId);
      continue;
    }
    if (expense.receiptId !== row.receiptId) {
      setReceiptState(ctx.db, row.receiptId, 'discard', now());
      continue;
    }
    if (expense.version === 0 || expense.dirty || !retryDue(row, now())) continue;

    const outcome = await deps.upload(pathOf(row), row.receiptId);
    if (outcome === 'ok') {
      setReceiptState(ctx.db, row.receiptId, 'synced', now());
      report.uploaded++;
    } else if (outcome === 'missingFile') {
      deleteReceiptFileRow(ctx.db, row.receiptId);
    } else {
      recordReceiptFailure(ctx.db, row.receiptId, outcome === 'denied' ? 'DENIED' : outcome.error, now());
      report.failed++;
    }
  }

  // Photos no expense points at any more (replaced on another phone, then synced here): free the space.
  const synced = receiptFilesInState(ctx.db, 'synced');
  const used = referencedReceiptIds(ctx.db, synced.map((r) => r.receiptId));
  for (const row of synced) {
    if (used.has(row.receiptId)) continue;
    deps.deleteLocal(row.receiptId);
    deleteReceiptFileRow(ctx.db, row.receiptId);
  }

  return report;
}
