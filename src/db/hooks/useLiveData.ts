import { addDatabaseChangeListener } from 'expo-sqlite';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { createChangeBatcher } from './changeBatcher';

/**
 * Per-table change counters, fed by a single SQLite change listener for the whole app.
 * Requires the DB to be opened with enableChangeListener (see db/client.ts).
 *
 * SQLite reports every changed ROW. A sync that pulls 500 rows used to re-render every live
 * screen (Home, Settle, Activity, the open group…) 500 times, each re-running its queries: the
 * app crawled for seconds after signing in and after each big pull. Changes are now batched and
 * published at most once per BATCH_MS, so a 500-row pull costs a handful of recomputes.
 */
const BATCH_MS = 120;

const batcher = createChangeBatcher(BATCH_MS);
let listening = false;

function subscribe(notify: () => void): () => void {
  if (!listening) {
    listening = true;
    addDatabaseChangeListener((event) => batcher.record(event.tableName));
  }
  return batcher.subscribe(notify);
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

  const getSnapshot = useCallback(() => batcher.snapshot(tableKey.split(',')), [tableKey]);

  // A string snapshot compares by value, so unrelated table changes don't re-render.
  const version = useSyncExternalStore(subscribe, getSnapshot);

  return useMemo(() => ({ version, data: compute() }), [version, compute]).data;
}
