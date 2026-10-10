import { Directory, File, Paths } from 'expo-file-system';

/**
 * Where receipt photos live on the phone.
 * - Own photos (taken here): documents/receipts/<id>.jpg. Durable: they may be the only copy until
 *   uploaded, so the OS must not clear them.
 * - Downloaded photos (someone else's, or own after a reinstall): cache/receipts/<id>.jpg. The OS
 *   may clear these; they are downloaded again on tap.
 */
const ownDir = () => new Directory(Paths.document, 'receipts');
const cacheDir = () => new Directory(Paths.cache, 'receipts');

const ensure = (dir: Directory) => {
  dir.create({ intermediates: true, idempotent: true });
  return dir;
};

export const ownReceiptFile = (receiptId: string) => new File(ownDir(), `${receiptId}.jpg`);
export const cachedReceiptFile = (receiptId: string) => new File(cacheDir(), `${receiptId}.jpg`);

/** A compressed photo picked for the form, not saved with an expense yet (lives in the cache). */
export interface StagedReceipt {
  receiptId: string;
  uri: string;
  bytes: number;
}

/**
 * Move a staged photo into the durable folder, right before the expense is saved. Throws if the
 * file system refuses (storage full); the caller then doesn't save the receipt.
 */
export function commitStagedReceipt(staged: StagedReceipt): { receiptId: string; bytes: number } {
  const target = new File(ensure(ownDir()), `${staged.receiptId}.jpg`);
  new File(staged.uri).moveSync(target, { overwrite: true });
  return { receiptId: staged.receiptId, bytes: target.size || staged.bytes };
}

/** Local copy to show, if this phone has one. */
export function localReceiptUri(receiptId: string): string | null {
  const own = ownReceiptFile(receiptId);
  if (own.exists) return own.uri;
  const cached = cachedReceiptFile(receiptId);
  return cached.exists ? cached.uri : null;
}

export function deleteLocalReceipt(receiptId: string): void {
  for (const file of [ownReceiptFile(receiptId), cachedReceiptFile(receiptId)]) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Best effort: a leftover file is only wasted space.
    }
  }
}

/** Destination for a download; makes sure the folder exists. */
export const downloadTarget = (receiptId: string) => new File(ensure(cacheDir()), `${receiptId}.jpg`);
