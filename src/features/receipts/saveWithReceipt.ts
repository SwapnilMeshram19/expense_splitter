import { appContext } from '@/db/appContext';
import { markReceiptDiscarded, registerOwnReceipt } from '@/db/repositories/receipts';

import { commitStagedReceipt, deleteLocalReceipt, type StagedReceipt } from './receiptFiles';
import { processReceiptQueue } from './receiptStorage';

interface ReceiptTarget {
  groupId: string;
  expenseId: string;
  /** The photo the expense pointed at before this save (edits), or null. */
  previousReceiptId?: string | null;
  /** The photo it points at after this save, or null. */
  nextReceiptId: string | null;
}

/**
 * Save an expense together with a newly picked photo: move the photo into the durable folder,
 * send the expense, then record the photo for upload (it uploads once the expense is on the
 * server). A failed save moves nothing. Returns the save's result, or a message for the file step.
 */
export async function saveWithReceipt<R extends { ok: boolean }>(
  staged: StagedReceipt | undefined,
  target: ReceiptTarget,
  write: (newReceiptId: string | null) => Promise<R>,
): Promise<R | { ok: false; fileError: string }> {
  let committed: { receiptId: string; bytes: number } | null = null;
  if (staged) {
    try {
      committed = commitStagedReceipt(staged);
    } catch {
      return {
        ok: false,
        fileError: 'Couldn’t save the receipt photo. Free up some space on your phone, or remove the photo.',
      };
    }
  }
  const result = await write(committed?.receiptId ?? null);
  if (!result.ok) {
    if (committed) deleteLocalReceipt(committed.receiptId);
    return result;
  }

  const now = Date.now();
  const ref = { groupId: target.groupId, expenseId: target.expenseId };
  if (committed) registerOwnReceipt(appContext.db, { ...ref, receiptId: committed.receiptId, bytes: committed.bytes }, now);
  const next = committed?.receiptId ?? target.nextReceiptId;
  if (target.previousReceiptId && target.previousReceiptId !== next) {
    markReceiptDiscarded(appContext.db, { ...ref, receiptId: target.previousReceiptId }, now);
  }
  void processReceiptQueue();
  return result;
}
