import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { AppDb, RepoContext } from '../context';
import * as schema from '../schema';

export interface TestContext {
  ctx: RepoContext;
  /** Move the fake clock forward. */
  advance: (ms: number) => void;
  close: () => void;
}

/**
 * Fresh in-memory SQLite with the real generated migrations applied.
 * better-sqlite3 is synchronous like expo-sqlite and Drizzle exposes the same query API,
 * so repositories run unchanged.
 */
export function createTestContext(): TestContext {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: 'src/db/migrations' });

  let counter = 0;
  let clock = 1_759_300_000_000;

  return {
    ctx: {
      db: db as unknown as AppDb,
      newId: () => `id-${String(++counter).padStart(4, '0')}`,
      now: () => clock,
    },
    advance: (ms) => {
      clock += ms;
    },
    close: () => sqlite.close(),
  };
}