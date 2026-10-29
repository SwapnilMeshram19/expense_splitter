/**
 * Cache + offline queue in IndexedDB: the browser side of the store's Persistence interface
 * (the app uses SQLite, src/data/sqlitePersistence.ts).
 *
 * The store's interface is synchronous and IndexedDB isn't, so this is write-behind:
 * - everything is read once at start-up (before the store hydrates), then load() returns it;
 * - each write is queued in order and committed in the background.
 * A tab closed mid-write loses at most that write. For a snapshot that's only a slower start
 * (the server is the truth); for a queued op, the store saves it before sending, and the request
 * id makes a resend safe.
 *
 * Several tabs share the database. Each keeps its own memory copy and may send the same queued op
 * once more after another tab already did: harmless, the server answers a repeated request id
 * with the stored result.
 *
 * No IndexedDB (some private windows, blocked site data): returns undefined. The store then works
 * online only and offline adds are refused instead of queued.
 */
import { createStore, delMany, entries, keys, set, del, type UseStore } from 'idb-keyval';

import type { GroupSnapshot } from '@/domain/model';
import type { PendingOp, Persistence, SavedState } from '@/data/store';

const DB_NAME = 'expense-splitter';
const STORE_NAME = 'data-cache-v1';
const META = 'meta';
const GROUP = 'g:';
const OP = 'op:';
const OPEN_TIMEOUT_MS = 2_000;

interface Meta {
  userId: string | null;
  order: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('IndexedDB timed out')), ms)),
  ]);
}

function readState(rows: [IDBValidKey, unknown][]): SavedState | null {
  let meta: Meta = { userId: null, order: [] };
  const groups: GroupSnapshot[] = [];
  const ops: PendingOp[] = [];
  for (const [key, value] of rows) {
    if (typeof key !== 'string' || !isRecord(value)) continue;
    if (key === META) {
      meta = {
        userId: typeof value.userId === 'string' && value.userId ? value.userId : null,
        order: Array.isArray(value.order)
          ? value.order.filter((id): id is string => typeof id === 'string')
          : [],
      };
    } else if (key.startsWith(GROUP)) {
      const snapshot = value as unknown as GroupSnapshot;
      if (isRecord(snapshot.group) && typeof snapshot.group.id === 'string') groups.push(snapshot);
    } else if (key.startsWith(OP)) {
      const op = value as unknown as PendingOp;
      if (typeof op.requestId === 'string' && isRecord(op.cmd) && typeof op.at === 'number') {
        ops.push({ ...op, status: op.status === 'failed' ? 'failed' : 'queued' });
      }
    }
  }
  if (!meta.userId && groups.length === 0 && ops.length === 0) return null;
  ops.sort((a, b) => a.at - b.at || (a.requestId < b.requestId ? -1 : 1));
  return { userId: meta.userId, order: meta.order, groups, ops };
}

export async function openWebPersistence(): Promise<Persistence | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  let db: UseStore;
  let saved: SavedState | null;
  try {
    db = createStore(DB_NAME, STORE_NAME);
    saved = readState(await withTimeout(entries(db), OPEN_TIMEOUT_MS));
  } catch {
    return undefined;
  }

  // One chain: writes land in the order the store made them (a delete never overtakes its put).
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (write: () => Promise<unknown>) => {
    chain = chain.then(write).catch(() => undefined);
  };

  return {
    load: () => saved,

    saveMeta(meta) {
      const value: Meta = { userId: meta.userId, order: [...meta.order] };
      enqueue(() => set(META, value, db));
    },

    saveGroup(snapshot) {
      enqueue(() => set(GROUP + snapshot.group.id, snapshot, db));
    },

    removeGroup(groupId) {
      enqueue(() => del(GROUP + groupId, db));
    },

    clearGroups() {
      enqueue(async () => {
        const all = await keys(db);
        await delMany(
          all.filter((k): k is string => typeof k === 'string' && k.startsWith(GROUP)),
          db,
        );
      });
    },

    putOp(op) {
      // Stored as 'queued': a send cut off by closing the tab is resent on the next start.
      const stored: PendingOp = { ...op, status: op.status === 'failed' ? 'failed' : 'queued' };
      enqueue(() => set(OP + op.requestId, stored, db));
    },

    deleteOp(requestId) {
      enqueue(() => del(OP + requestId, db));
    },
  };
}

/** Sign-out on a shared computer: nothing of this account stays in the browser. */
export async function wipeWebPersistence(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
