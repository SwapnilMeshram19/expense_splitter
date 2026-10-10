import { File } from 'expo-file-system';

import { appContext } from '@/db/appContext';
import { recordDownloadedReceipt } from '@/db/repositories/receipts';
import { receiptObjectPath } from '@/domain/note';
import { getSupabase } from '@/lib/supabase';
import { onSyncSucceeded } from '@/sync/syncService';

import {
  deleteLocalReceipt,
  downloadTarget,
  localReceiptUri,
  ownReceiptFile,
} from './receiptFiles';
import { runReceiptQueue, type ReceiptQueueDeps, type UploadOutcome } from './receiptQueue';

const BUCKET = 'receipts';

const storage = () => getSupabase().storage.from(BUCKET);

function describeStorageError(error: { message?: string; status?: number; statusCode?: string }): string {
  return `${error.statusCode ?? error.status ?? ''} ${error.message ?? 'error'}`.trim().slice(0, 200);
}

export const supabaseReceiptDeps: ReceiptQueueDeps = {
  async upload(path, receiptId): Promise<UploadOutcome> {
    const file = ownReceiptFile(receiptId);
    if (!file.exists) return 'missingFile';
    const body = await file.bytes();
    const { error } = await storage().upload(path, body, { contentType: 'image/jpeg', upsert: false });
    if (!error) return 'ok';
    const e = error as { message?: string; status?: number; statusCode?: string };
    const code = String(e.statusCode ?? e.status ?? '');
    // Already there: an earlier attempt succeeded but the response was lost.
    if (code === '409' || /already exists|duplicate/i.test(e.message ?? '')) return 'ok';
    if (code === '403' || /row-level security|unauthorized/i.test(e.message ?? '')) return 'denied';
    return { error: describeStorageError(e) };
  },
  async remove(path) {
    const { error } = await storage().remove([path]);
    return error ? { error: describeStorageError(error) } : 'ok';
  },
  hasLocal: (receiptId) => ownReceiptFile(receiptId).exists,
  deleteLocal: deleteLocalReceipt,
};

let running: Promise<unknown> | null = null;

/** Upload/clean up receipt photos. Calls during a run share it. Never throws. */
export function processReceiptQueue(): Promise<unknown> {
  running ??= runReceiptQueue(appContext, supabaseReceiptDeps)
    .catch((e) => {
      if (__DEV__) console.log('[receipt] queue failed', (e as Error | null)?.message);
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** After every successful sync: the expenses are on the server, so their photos can follow. */
export function startReceiptQueue(): () => void {
  return onSyncSucceeded(() => void processReceiptQueue());
}

export type ReceiptLoad =
  | { ok: true; uri: string }
  | { ok: false; reason: 'SIGNED_OUT' | 'NOT_UPLOADED' | 'OFFLINE' };

/**
 * The photo for an expense: the local copy, or download it now (only ever on a tap, so a group
 * full of receipts costs nothing until someone actually looks at one).
 */
export async function loadReceipt(ref: {
  groupId: string;
  expenseId: string;
  receiptId: string;
}): Promise<ReceiptLoad> {
  const local = localReceiptUri(ref.receiptId);
  if (local) return { ok: true, uri: local };

  const { data: session } = await getSupabase().auth.getSession();
  if (!session.session) return { ok: false, reason: 'SIGNED_OUT' };

  const path = receiptObjectPath(ref.groupId, ref.expenseId, ref.receiptId);
  let signed: string;
  try {
    const { data, error } = await storage().createSignedUrl(path, 120);
    // Missing object (and refused access, which storage reports the same way): not uploaded yet.
    if (error || !data?.signedUrl) return { ok: false, reason: 'NOT_UPLOADED' };
    signed = data.signedUrl;
  } catch {
    return { ok: false, reason: 'OFFLINE' };
  }

  try {
    const file: File = await File.downloadFileAsync(signed, downloadTarget(ref.receiptId), {
      idempotent: true,
    });
    recordDownloadedReceipt(appContext.db, ref, file.size ?? null, appContext.now());
    return { ok: true, uri: file.uri };
  } catch {
    return { ok: false, reason: 'OFFLINE' };
  }
}

export function describeReceiptLoadError(reason: Exclude<ReceiptLoad, { ok: true }>['reason']): string {
  switch (reason) {
    case 'SIGNED_OUT':
      return 'Sign in to see receipt photos shared in this group.';
    case 'NOT_UPLOADED':
      return 'Not uploaded yet. It appears once the phone that took it is back online.';
    case 'OFFLINE':
      return 'Couldn’t load the photo. Check your connection and try again.';
  }
}
