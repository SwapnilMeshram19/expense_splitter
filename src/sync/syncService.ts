import { useSyncExternalStore } from 'react';

import { appContext } from '@/db/appContext';
import { getSupabase } from '@/lib/supabase';

import { getSyncIssues } from './engine';
import { countPendingChanges } from './issueActions';
import { runSync } from './runSync';
import { supabaseTransport, type SyncErrorCode } from './transport';

export type SyncOutcome = 'ok' | 'signedOut' | SyncErrorCode | 'UNKNOWN';

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'signedOut';
  lastSyncedAt: number | null;
  message: string | null;
  errorCode: SyncErrorCode | 'UNKNOWN' | null;
  issueCount: number;
  pendingCount: number;
}

const MESSAGES: Record<SyncErrorCode | 'UNKNOWN', string> = {
  OFFLINE: 'No internet. Your changes are saved on this phone and will sync when you’re back online.',
  UNAUTHENTICATED: 'Please sign in again to sync.',
  BATCH_REFUSED: 'Some changes couldn’t be sent. Please update the app.',
  SERVER: 'Sync is having trouble. It will try again shortly.',
  UNKNOWN: 'Sync failed. It will try again shortly.',
};

let status: SyncStatus = {
  state: 'idle',
  lastSyncedAt: null,
  message: null,
  errorCode: null,
  issueCount: 0,
  pendingCount: 0,
};
const listeners = new Set<() => void>();

function emit(next: SyncStatus): void {
  status = next;
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, () => status);
}

const counts = () => ({
  issueCount: getSyncIssues(appContext).length,
  pendingCount: countPendingChanges(appContext),
});

/** Re-read issue and pending counts (after resolving an issue, or a local edit). */
export function refreshSyncStatus(): void {
  emit({ ...status, ...counts() });
}

/** Mark signed out (no sync, no error shown). */
export function markSignedOut(): void {
  emit({ ...status, state: 'signedOut', message: null, errorCode: null, ...counts() });
}

const errorCode = (e: unknown): SyncErrorCode | 'UNKNOWN' => {
  const o = e as { name?: string; code?: SyncErrorCode } | null;
  return o?.name === 'SyncError' && o.code ? o.code : 'UNKNOWN';
};

const successListeners = new Set<() => void>();

/** Called after every successful cycle, whoever started it (scheduler, pull-to-refresh, join). */
export function onSyncSucceeded(listener: () => void): () => void {
  successListeners.add(listener);
  return () => {
    successListeners.delete(listener);
  };
}

let inFlight: Promise<SyncOutcome> | null = null;

export const isSyncing = () => inFlight !== null;

/** Runs one sync cycle. Calls made while one is running share it instead of starting another. */
export function syncNow(): Promise<SyncOutcome> {
  inFlight ??= (async (): Promise<SyncOutcome> => {
    try {
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) {
        markSignedOut();
        return 'signedOut';
      }
      emit({ ...status, state: 'syncing', message: null, errorCode: null });
      await runSync(appContext, supabaseTransport);
      emit({ state: 'idle', lastSyncedAt: Date.now(), message: null, errorCode: null, ...counts() });
      successListeners.forEach((listener) => listener());
      return 'ok';
    } catch (e) {
      const code = errorCode(e);
      if (__DEV__) console.log('[sync] failed', { code, message: (e as Error | null)?.message });
      emit({ ...status, state: 'error', message: MESSAGES[code], errorCode: code, ...counts() });
      return code;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}