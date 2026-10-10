import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import type { AppDb } from '../context';
import { expenses, receiptFiles, type ReceiptFile, type ReceiptFileState } from '../schema';

type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];
type Db = AppDb | Tx;

export interface ReceiptRef {
  receiptId: string;
  expenseId: string;
  groupId: string;
}

/** A photo just taken on this phone (file already in the documents folder): upload it later. */
export function registerOwnReceipt(db: Db, ref: ReceiptRef & { bytes: number }, now: number): void {
  db.insert(receiptFiles)
    .values({ ...ref, state: 'upload', bytes: ref.bytes, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: receiptFiles.receiptId,
      set: { state: 'upload', bytes: ref.bytes, attempts: 0, lastError: null, updatedAt: now },
    })
    .run();
}

/** The expense stopped using this photo: delete the server copy when allowed, then the local one. */
export function markReceiptDiscarded(db: Db, ref: ReceiptRef, now: number): void {
  db.insert(receiptFiles)
    .values({ ...ref, state: 'discard', createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: receiptFiles.receiptId,
      set: { state: 'discard', attempts: 0, lastError: null, updatedAt: now },
    })
    .run();
}

/** A photo downloaded from the server into the cache. Never downgrades a pending upload. */
export function recordDownloadedReceipt(db: Db, ref: ReceiptRef, bytes: number | null, now: number): void {
  db.insert(receiptFiles)
    .values({ ...ref, state: 'synced', bytes, createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .run();
}

export const getReceiptFile = (db: Db, receiptId: string): ReceiptFile | null =>
  db.select().from(receiptFiles).where(eq(receiptFiles.receiptId, receiptId)).get() ?? null;

export const receiptFilesInState = (db: Db, state: ReceiptFileState): ReceiptFile[] =>
  db.select().from(receiptFiles).where(eq(receiptFiles.state, state)).all();

export function setReceiptState(db: Db, receiptId: string, state: ReceiptFileState, now: number): void {
  db.update(receiptFiles)
    .set({ state, attempts: 0, lastError: null, updatedAt: now })
    .where(eq(receiptFiles.receiptId, receiptId))
    .run();
}

export function recordReceiptFailure(db: Db, receiptId: string, error: string, now: number): void {
  const row = getReceiptFile(db, receiptId);
  if (!row) return;
  db.update(receiptFiles)
    .set({ attempts: row.attempts + 1, lastError: error.slice(0, 200), updatedAt: now })
    .where(eq(receiptFiles.receiptId, receiptId))
    .run();
}

export const deleteReceiptFileRow = (db: Db, receiptId: string): void => {
  db.delete(receiptFiles).where(eq(receiptFiles.receiptId, receiptId)).run();
};

/**
 * Receipt ids some local expense still points at, deleted expenses included (a deleted expense
 * can be restored, and conflict review can bring an old version back). Never discard these.
 */
export function referencedReceiptIds(db: Db, receiptIds?: readonly string[]): Set<string> {
  const rows = db
    .select({ id: expenses.receiptId })
    .from(expenses)
    .where(
      receiptIds
        ? and(isNotNull(expenses.receiptId), inArray(expenses.receiptId, [...receiptIds]))
        : isNotNull(expenses.receiptId),
    )
    .all();
  return new Set(rows.map((r) => r.id!));
}

/** The expense row a receipt belongs to, if it's on this phone. */
export const receiptExpense = (db: Db, expenseId: string) =>
  db
    .select({
      receiptId: expenses.receiptId,
      version: expenses.version,
      dirty: expenses.dirty,
      groupId: expenses.groupId,
    })
    .from(expenses)
    .where(eq(expenses.id, expenseId))
    .get() ?? null;

/** Count of photos still waiting to upload (shown in the sync panel). */
export const pendingReceiptUploads = (db: Db): number =>
  db.select({ id: receiptFiles.receiptId }).from(receiptFiles).where(eq(receiptFiles.state, 'upload')).all()
    .length;
