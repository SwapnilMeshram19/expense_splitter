/**
 * Browser wiring for the shared data store (the app's version is src/data/native.ts): IndexedDB
 * cache + queue, online/offline and tab-visibility events, Realtime change signals.
 *
 * When data is fetched:
 * - at start (after the cache is shown), when the tab becomes visible again, and on reconnect;
 * - when a screen opens, if the last fetch is older than FOCUS_REFRESH_MS;
 * - after a change signal for a group (someone else saved something).
 *
 * navigator.onLine only knows about the network interface, not the internet: "online" can still
 * fail. That's fine: a failed call comes back as OFFLINE and the store queues or refuses as usual.
 */
import { createApi } from '@/api/client';
import { configureDataStore, dataStore, PENDING_USER } from '@/data';
import { syncOrigin } from '@/data/origin';
import { createChangeSignals } from '@/data/realtime';
import { getSupabase } from '@/lib/supabase';
import { newId } from '@/lib/newId';

import { openWebPersistence } from './persistence';

const FOCUS_REFRESH_MS = 30_000;
/** Wait after a signal so a burst of saves on another device becomes one refetch. */
const SIGNAL_DELAY_MS = 1_500;

let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible';
let started = false;
const reconnectListeners = new Set<() => void>();
const connectionListeners = new Set<() => void>();

export const isOnline = (): boolean => online;

/** Called when the connection comes back (auth uses it to create the anonymous account). */
export function onReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

/** For the offline banner. */
export function subscribeConnection(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => {
    connectionListeners.delete(listener);
  };
}

/** Refresh button: send anything waiting, then fetch every group. */
export async function refreshNow(): Promise<void> {
  const store = dataStore();
  await store.flush();
  await store.refreshAll();
}

/** A screen opened: fetch if the last fetch is old. Cheap when nothing changed. */
export function refreshIfStale(): void {
  const store = dataStore();
  const last = store.getStatus().lastRefreshAt;
  if (last === null || Date.now() - last >= FOCUS_REFRESH_MS) void store.refreshAll();
}

/** Call once before rendering and before startAuth (auth tells the store which account it serves). */
export async function startData(): Promise<void> {
  if (started) return;
  started = true;

  const persistence = await openWebPersistence();
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
    // Hidden tabs close their sockets: background tabs are throttled anyway, and an open socket
    // per tab adds up against the Realtime connection limit.
    const ids =
      visible && online && user && user !== PENDING_USER
        ? store.groups().map((g) => g.group.id)
        : [];
    const key = ids.join(',');
    if (key === lastChannels) return;
    lastChannels = key;
    signals.update(ids);
  };
  store.subscribe(updateSignals);

  // ── Network ──
  const setOnline = (now: boolean) => {
    const cameBack = now && !online;
    online = now;
    connectionListeners.forEach((l) => l());
    updateSignals();
    if (cameBack) {
      reconnectListeners.forEach((l) => l());
      void store.flush().then(() => store.refreshAll());
    }
  };
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));

  // ── Visibility ──
  document.addEventListener('visibilitychange', () => {
    const wasVisible = visible;
    visible = document.visibilityState === 'visible';
    updateSignals();
    if (visible && !wasVisible) {
      void store.flush();
      refreshIfStale();
    }
  });
}
