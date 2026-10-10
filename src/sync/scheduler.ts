import NetInfo from '@react-native-community/netinfo';
import { addDatabaseChangeListener } from 'expo-sqlite';
import { AppState, type AppStateStatus } from 'react-native';

import { appContext } from '@/db/appContext';
import { getSupabase } from '@/lib/supabase';

import { countPendingChanges } from './issueActions';
import { setChangeSignalHandler, updateChangeSignals } from './realtime';
import { remoteSyncDelay, REMOTE_DELAY_MS } from './signalPlan';
import { isSyncing, markSignedOut, onSyncSucceeded, refreshSyncStatus, syncNow } from './syncService';

const EDIT_DEBOUNCE_MS = 4_000;
const SOON_MS = 1_000;
const FOREGROUND_INTERVAL_MS = 5 * 60_000;
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
const SYNCED_TABLES = new Set([
  'groups',
  'members',
  'expenses',
  'expense_payers',
  'expense_shares',
  'settlements',
  'activity_log',
]);

type Reason = 'edit' | 'network' | 'foreground' | 'interval' | 'signin' | 'retry' | 'remote';

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let queuedReason: Reason | null = null;
let failures = 0;
let online = true;
let active = AppState.currentState === 'active';
let signedIn = false;
let lastRemoteSyncAt: number | null = null;

/** Change-signal channels are open only while it can help: signed in, online, in the foreground. */
function refreshChangeSignals(): void {
  updateChangeSignals(signedIn && online && active);
}

function schedule(delayMs: number, reason: Reason): void {
  // A non-edit reason always wins: it needs a pull even with nothing pending.
  queuedReason = queuedReason && queuedReason !== 'edit' ? queuedReason : reason;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), delayMs);
}

function cancel(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  queuedReason = null;
}

async function run(): Promise<void> {
  const reason = queuedReason;
  timer = null;
  queuedReason = null;
  if (!online || !active) return; // network / foreground listeners reschedule

  // A signal during a running cycle may be newer than that cycle's pull: go again once it ends.
  if (reason === 'remote' && isSyncing()) {
    schedule(REMOTE_DELAY_MS, 'remote');
    return;
  }
  if (reason === 'remote') lastRemoteSyncAt = Date.now();

  // Edits made by sync itself leave nothing pending, so they never start another cycle.
  if (reason === 'edit' && countPendingChanges(appContext) === 0) {
    refreshSyncStatus();
    return;
  }

  const outcome = await syncNow();
  if (outcome === 'ok' || outcome === 'signedOut') {
    failures = 0;
    return;
  }
  if (outcome === 'OFFLINE') return; // wait for NetInfo instead of polling a dead network

  const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!;
  failures++;
  schedule(delay, 'retry');
}

/** Call once, after startAuth() (account linking must run before the first push). */
export function startSyncScheduler(): void {
  if (started) return;
  started = true;

  setChangeSignalHandler(() => {
    if (active) schedule(remoteSyncDelay(Date.now(), lastRemoteSyncAt), 'remote');
  });
  // After every successful sync the set of groups may have changed (joined, created, lost).
  onSyncSucceeded(refreshChangeSignals);

  NetInfo.addEventListener((state) => {
    // isInternetReachable is null while unknown: treat as reachable rather than block sync.
    const nowOnline = state.isConnected !== false && state.isInternetReachable !== false;
    const cameBack = nowOnline && !online;
    const wentOffline = !nowOnline && online;
    online = nowOnline;
    if (cameBack) schedule(SOON_MS, 'network');
    if (wentOffline) refreshChangeSignals(); // reopened by the sync that runs when we're back
  });

  AppState.addEventListener('change', (next: AppStateStatus) => {
    const wasActive = active;
    active = next === 'active';
    if (active && !wasActive) schedule(SOON_MS, 'foreground'); // its success reopens the channels
    if (!active) {
      cancel();
      refreshChangeSignals();
    }
  });

  addDatabaseChangeListener((event) => {
    if (!SYNCED_TABLES.has(event.tableName)) return;
    if (isSyncing()) return; // the engine's own writes
    schedule(EDIT_DEBOUNCE_MS, 'edit');
  });

  setInterval(() => {
    if (active && !timer) schedule(0, 'interval');
  }, FOREGROUND_INTERVAL_MS);

  try {
    getSupabase().auth.onAuthStateChange((event, session) => {
      // Deferred: never call supabase inside this callback, and let account linking finish first.
      setTimeout(() => {
        if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
          failures = 0;
          signedIn = true;
          schedule(0, 'signin');
        } else if (event === 'SIGNED_OUT') {
          cancel();
          failures = 0;
          signedIn = false;
          refreshChangeSignals();
          markSignedOut();
        }
      }, 0);
    });
  } catch {
    // Sign-in not configured in this build: the app stays fully offline, nothing to schedule.
    markSignedOut();
  }
}