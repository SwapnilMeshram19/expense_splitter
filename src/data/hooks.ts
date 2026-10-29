/**
 * React access to the data store (React only, no React Native: the web app uses these too).
 *
 * useData(compute) re-runs `compute` whenever the store changes (a refetch, a save, a queued
 * change) and otherwise returns the same value, like useLiveData did for SQLite.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { CommandInputs, CommandOp } from '@/domain/commands';

import { dataStore } from './index';
import type { ActivityState, DataStatus, RunResult } from './store';

function useVersion(): number {
  const store = dataStore();
  return useSyncExternalStore(store.subscribe, store.getVersion);
}

/**
 * Recomputes when the store version or one of `deps` changes. A useMemo wrapper whose deps are
 * the caller's (the same pattern as useMemo itself), so the literal-array rule can't apply here.
 */
export function useData<T>(compute: () => T, deps: readonly unknown[] = []): T {
  const version = useVersion();
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps
  return useMemo(compute, [version, ...deps]);
}

export function useDataStatus(): DataStatus {
  useVersion();
  return dataStore().getStatus();
}

/** History for a group (or all groups with null): loads when shown and whenever it went stale. */
export function useActivity(scope: string | null): ActivityState & { loadMore: () => void; reload: () => void } {
  useVersion();
  const state = dataStore().activityOf(scope);
  useEffect(() => {
    if (state.stale && !state.loading) void dataStore().loadActivity(scope);
  }, [scope, state.stale, state.loading]);
  const loadMore = useCallback(() => void dataStore().loadActivity(scope, { more: true }), [scope]);
  const reload = useCallback(() => void dataStore().loadActivity(scope), [scope]);
  return { ...state, loadMore, reload };
}

/** Save a change: plans it, shows it at once, sends it (or queues it offline). */
export function runCommand<K extends CommandOp>(op: K, input: CommandInputs[K]): Promise<RunResult<K>> {
  return dataStore().run(op, input);
}
