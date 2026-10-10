import type { Result } from '@/lib/result';

import { commitStagedReceipt, deleteLocalReceipt, type StagedReceipt } from './receiptFiles';

type NewReceipt = { receiptId: string; bytes: number } | null;

/**
 * Save an expense together with a newly picked photo: move the photo into the durable folder,
 * write the expense (which records the photo for upload in the same transaction), and undo the
 * move if the write fails. Returns the write's result, or an error message for the file step.
 */
export function saveWithReceipt<T, E>(
  staged: StagedReceipt | undefined,
  write: (newReceipt: NewReceipt) => Result<T, E>,
): Result<T, E> | { ok: false; fileError: string } {
  let committed: NewReceipt = null;
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
  const result = write(committed);
  if (!result.ok && committed) deleteLocalReceipt(committed.receiptId);
  return result;
}
