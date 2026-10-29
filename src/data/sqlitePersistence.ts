/**
 * Cache and offline queue in SQLite (Android). Its own database file, so it can be cleared without
 * touching settings. Snapshots are stored whole, one row per group: they're read once at launch
 * and written when the server sends a new one.
 *
 * Written against a tiny synchronous SQLite interface (expo-sqlite's, also met by better-sqlite3
 * in tests).
 */
import type { GroupSnapshot } from '@/domain/model';

import type { PendingOp, Persistence, SavedState } from './store';

export interface SyncSqlite {
  execSync(sql: string): void;
  runSync(sql: string, ...params: (string | number | null)[]): unknown;
  getAllSync<T>(sql: string, ...params: (string | number | null)[]): T[];
}

const SCHEMA = `
create table if not exists cache_meta (key text primary key, value text not null);
create table if not exists cache_groups (id text primary key, rev text not null, json text not null);
create table if not exists outbox (
  request_id text primary key,
  group_id text not null,
  op text not null,
  input text not null,
  at integer not null,
  status text not null,
  error text
);
`;

export function createSqlitePersistence(db: SyncSqlite): Persistence {
  db.execSync(SCHEMA);

  const parse = <T>(text: string): T | null => {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  };

  return {
    load(): SavedState | null {
      const meta = new Map(db.getAllSync<{ key: string; value: string }>('select key, value from cache_meta').map((r) => [r.key, r.value]));
      const groups = db
        .getAllSync<{ json: string }>('select json from cache_groups')
        .map((r) => parse<GroupSnapshot>(r.json))
        .filter((g): g is GroupSnapshot => !!g && !!g.group?.id);
      const ops = db
        .getAllSync<{ request_id: string; group_id: string; op: string; input: string; at: number; status: string; error: string | null }>(
          'select * from outbox order by at, request_id',
        )
        .flatMap((r): PendingOp[] => {
          const input = parse<object>(r.input);
          if (!input) return [];
          return [
            {
              requestId: r.request_id,
              groupId: r.group_id,
              cmd: { op: r.op, input } as PendingOp['cmd'],
              at: Number(r.at),
              status: r.status === 'failed' ? 'failed' : 'queued',
              ...(r.error ? { error: parse(r.error) ?? { code: 'SERVER' } } : {}),
            } as PendingOp,
          ];
        });
      if (!meta.size && groups.length === 0 && ops.length === 0) return null;
      return {
        userId: meta.get('user_id') || null,
        order: parse<string[]>(meta.get('order') ?? '[]') ?? [],
        groups,
        ops,
      };
    },

    saveMeta({ userId, order }) {
      db.runSync('insert or replace into cache_meta (key, value) values (?, ?)', 'user_id', userId ?? '');
      db.runSync('insert or replace into cache_meta (key, value) values (?, ?)', 'order', JSON.stringify(order));
    },

    saveGroup(snapshot) {
      db.runSync('insert or replace into cache_groups (id, rev, json) values (?, ?, ?)', snapshot.group.id, snapshot.rev, JSON.stringify(snapshot));
    },

    removeGroup(groupId) {
      db.runSync('delete from cache_groups where id = ?', groupId);
    },

    clearGroups() {
      db.runSync('delete from cache_groups');
    },

    putOp(op) {
      db.runSync(
        'insert or replace into outbox (request_id, group_id, op, input, at, status, error) values (?, ?, ?, ?, ?, ?, ?)',
        op.requestId,
        op.groupId,
        op.cmd.op,
        JSON.stringify(op.cmd.input),
        op.at,
        op.status === 'failed' ? 'failed' : 'queued',
        op.error ? JSON.stringify(op.error) : null,
      );
    },

    deleteOp(requestId) {
      db.runSync('delete from outbox where request_id = ?', requestId);
    },
  };
}
