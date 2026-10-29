/**
 * Android wiring for the data store: SQLite cache + queue, network and foreground events, change
 * signals. The web app wires the same store with browser equivalents.
 *
 * When data is fetched:
 * - at launch (after the cache is shown), on returning to the app, and on reconnect;
 * - when a screen comes into view, if the last fetch is older than FOCUS_REFRESH_MS;
 * - on pull-to-refresh;
 * - after a change signal for a group (someone else saved something).
 * Unchanged groups cost a few bytes: the server only resends groups whose rev moved.
 */
import NetInfo from '@react-native-community/netinfo';
import { openDatabaseSync } from 'expo-sqlite';
import { AppState, type AppStateStatus } from 'react-native';

import { createApi } from '@/api/client';
import { newId } from '@/lib/newId';
import { getSupabase } from '@/lib/supabase';

import { configureDataStore, dataStore, PENDING_USER } from './index';
import { syncOrigin } from './origin';
import { createChangeSignals } from './realtime';
import { createSqlitePersistence } from './sqlitePersistence';

export const CACHE_DATABASE = 'data-cache.db';
const FOCUS_REFRESH_MS = 30_000;
/** Wait after a signal so a burst of saves on another phone becomes one refetch. */
const SIGNAL_DELAY_MS = 1_500;

let online = true;
let active = AppState.currentState === 'active';
let started = false;
const reconnectListeners = new Set<() => void>();

export const isOnline = (): boolean => online;

/** Called when the connection comes back (auth uses it to create the anonymous account). */
export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

/** Pull-to-refresh: send anything waiting, then fetch every group. */
export async function refreshNow(): Promise<void> {
  const store = dataStore();
  await store.flush();
  await store.refreshAll();
}

/** A screen came into view: fetch if the last fetch is old. Cheap when nothing changed. */
export function refreshIfStale(): void {
  const store = dataStore();
  const last = store.getStatus().lastRefreshAt;
  if (last === null || Date.now() - last >= FOCUS_REFRESH_MS) void store.refreshAll();
}

/** Call once at startup, before startAuth (auth tells the store which account it serves). */
export function startData(): () => void {
  if (started) return () => undefined;
  started = true;

  let persistence;
  try {
    persistence = createSqlitePersistence(openDatabaseSync(CACHE_DATABASE));
  } catch {
    persistence = undefined; // no cache: the app still works online
  }
  const store = configureDataStore({
    api: createApi(getSupabase),
    persistence,
    network: { isOnline: () => online },
    newId,
    origin: syncOrigin,
  });
  store.hydrate();

  // ── Change signals ──
  const pendingSignals = new Map<string, ReturnType<typeof setTimeout>>();
  const signals = createChangeSignals(getSupabase, syncOrigin, (groupId) => {
    clearTimeout(pendingSignals.get(groupId));
    pendingSignals.set(
      groupId,
      setTimeout(() => {
        pendingSignals.delete(groupId);
        void store.refreshGroup(groupId);
      }, SIGNAL_DELAY_MS),
    );
  });
  let lastChannels = '';
  const updateSignals = () => {
    const user = store.getUserId();
    const ids = active && online && user && user !== PENDING_USER ? store.groups().map((g) => g.group.id) : [];
    const key = ids.join(',');
    if (key === lastChannels) return;
    lastChannels = key;
    signals.update(ids);
  };
  const stopStore = store.subscribe(updateSignals);

  // ── Network ──
  const stopNet = NetInfo.addEventListener((state) => {
    // isInternetReachable is null while unknown: treat as reachable rather than block saving.
    const now = state.isConnected !== false && state.isInternetReachable !== false;
    const cameBack = now && !online;
    online = now;
    updateSignals();
    if (cameBack) {
      reconnectListeners.forEach((l) => l());
      void store.flush().then(() => store.refreshAll());
    }
  });

  // ── Foreground ──
  const appState = AppState.addEventListener('change', (next: AppStateStatus) => {
    const wasActive = active;
    active = next === 'active';
    updateSignals();
    if (active && !wasActive) {
      void store.flush();
      refreshIfStale();
    }
  });

  return () => {
    stopStore();
    stopNet();
    appState.remove();
    signals.update([]);
    pendingSignals.forEach((t) => clearTimeout(t));
  };
}
