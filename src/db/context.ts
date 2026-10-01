// Type-only import: keeps expo-sqlite out of anything that only needs the type (e.g. Jest).
import type { Db } from './client';

export type AppDb = Db;

/** Transaction handle passed to db.transaction callbacks. */
export type Tx = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/**
 * Everything a repository needs, injected so tests can use an in-memory DB,
 * predictable ids and a fixed clock.
 *
 * The Expo SQLite driver is synchronous: transaction callbacks must be synchronous and use
 * .run() / .all() / .get(). An async callback would break atomicity silently.
 */
export interface RepoContext {
  db: AppDb;
  newId: () => string;
  now: () => number;
}