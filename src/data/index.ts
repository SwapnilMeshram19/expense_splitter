/**
 * The app-wide data store. Configured once at startup by the platform (startData in native.ts on
 * Android; the web app does the same with its own adapters), then read by every screen through
 * the hooks in hooks.ts.
 */
import { DataStore, type DataStoreDeps } from './store';

let store: DataStore | null = null;

export function configureDataStore(deps: DataStoreDeps): DataStore {
  store = new DataStore(deps);
  return store;
}

export function dataStore(): DataStore {
  if (!store) throw new Error('Data store used before configureDataStore()');
  return store;
}

/** The account to act as: the signed-in or anonymous user (a stand-in before the first sign-in). */
export const currentUserId = (): string => dataStore().planningUserId();

export { DataStore, PENDING_USER } from './store';
export type { ActivityState, CommandFailure, DataStatus, OpStatus, PendingOp, RunResult } from './store';
