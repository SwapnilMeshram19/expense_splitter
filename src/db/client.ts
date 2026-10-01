import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

export const DATABASE_NAME = 'expense-splitter.db';

// enableChangeListener powers useLiveQuery (screens re-render when tables change).
const sqlite = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

// WAL: faster writes, reads don't block writes. FKs are OFF by default in SQLite, per connection.
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
export type Db = typeof db;