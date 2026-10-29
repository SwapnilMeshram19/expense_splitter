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
import { createApi, isApiError, type Api } from '@/api/client';
import { configureDataStore, dataStore, PENDING_USER } from '@/data';
import { syncOrigin } from '@/data/origin';
import { createChangeSignals } from '@/data/realtime';
import { getSupabase } from '@/lib/supabase';
import { newId } from '@/lib/newId';

import { openWebPersistence } from './persistence';

const FOCUS_REFRESH_MS = 30_000;
/** While something waits to send (or the server couldn't be reached), try again this often. */
const RETRY_MS = 20_000;
/** Wait after a signal so a burst of saves on another device becomes one refetch. */
const SIGNAL_DELAY_MS = 1_500;

let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
let visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible';
let started = false;
const reconnectListeners = new Set<() => void>();
const connectionListeners = new Set<() => void>();

/**
 * The browser says it's online but the server didn't answer. Usually a real network problem, but
 * also what a CORS refusal looks like from JavaScript (the api function only answers origins in
 * its WEB_ORIGINS secret), so it gets its own banner instead of "you're offline".
 */
let serverUnreachable = false;

export const isOnline = (): boolean => online;
export const isServerUnreachable = (): boolean => online && serverUnreachable;

function setUnreachable(next: boolean): void {
  if (next === serverUnreachable) return;
  serverUnreachable = next;
  connectionListeners.forEach((l) => l());
  if (next && import.meta.env.DEV) {
    console.warn(
      `[web] The server didn't answer although the browser is online. If the Network tab shows a ` +
        `CORS error on functions/v1/api, add ${window.location.origin} to the WEB_ORIGINS secret.`,
    );
  }
}

/** Watches every call: an OFFLINE error while online marks the server unreachable, any answer clears it. */
function watched(api: Api): Api {
  const track = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      const result = await call();
      setUnreachable(false);
      return result;
    } catch (e) {
      if (isApiError(e) && e.code === 'OFFLINE' && online) setUnreachable(true);
      else if (isApiError(e)) setUnreachable(false); // the server answered, just with an error
      throw e;
    }
  };
  return {
    run: (commands, origin) => track(() => api.run(commands, origin)),
    listGroups: (known) => track(() => api.listGroups(known)),
    getGroup: (groupId, rev) => track(() => api.getGroup(groupId, rev)),
    listActivity: (groupId, before, limit) => track(() => api.listActivity(groupId, before, limit)),
  };
}

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
    api: watched(createApi(getSupabase)),
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

  // ── Retry ──
  // Reconnect and visibility events don't fire when the network was "up" all along but a send
  // failed (flaky mobile data, server hiccup): try again on a timer while it matters.
  setInterval(() => {
    if (!visible || !online) return;
    if (store.getStatus().queued > 0) void store.flush();
    else if (serverUnreachable) void store.refreshAll();
  }, RETRY_MS);

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
