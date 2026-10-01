import { addDatabaseChangeListener } from 'expo-sqlite';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Per-table change counters, fed by a single SQLite change listener for the whole app.
 * Requires the DB to be opened with enableChangeListener (see db/client.ts).
 */
const tableVersions = new Map<string, number>();
const subscribers = new Set<() => void>();
let listening = false;

function ensureListening(): void {
  if (listening) return;
  listening = true;
  addDatabaseChangeListener((event) => {
    tableVersions.set(event.tableName, (tableVersions.get(event.tableName) ?? 0) + 1);
    subscribers.forEach((notify) => notify());
  });
}

function subscribe(notify: () => void): () => void {
  ensureListening();
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

/**
 * Recompute `compute` whenever any of `tables` changes (inserts/updates/deletes, including
 * writes made later by sync). Use for screens derived from several tables, e.g. balances.
 *
 * `compute` must be stable: a module-level function, or wrapped in useCallback with its
 * own dependencies (e.g. groupId) so the lint rules can check them.
 */
export function useLiveData<T>(tables: readonly string[], compute: () => T): T {
  const tableKey = tables.join(',');

  const getSnapshot = useCallback(
    () =>
      tableKey
        .split(',')
        .map((table) => tableVersions.get(table) ?? 0)
        .join(':'),
    [tableKey],
  );

  // A string snapshot compares by value, so unrelated table changes don't re-render.
  const version = useSyncExternalStore(subscribe, getSnapshot);

  return useMemo(() => ({ version, data: compute() }), [version, compute]).data;
}