import Database from 'better-sqlite3';

import { ApiError, type Api, type CommandRequest, type CommandResult } from '@/api/client';
import { applyPlan, planCommand, type Command } from '@/domain/commands';
import type { GroupSnapshot } from '@/domain/model';

import { createSqlitePersistence, type SyncSqlite } from '../sqlitePersistence';
import { DataStore, PENDING_USER } from '../store';

const U1 = 'a0000000-0000-4000-8000-000000000001';
const U2 = 'a0000000-0000-4000-8000-000000000002';
const G = '90000000-0000-4000-8000-000000000001';
const ME = 'b0000000-0000-4000-8000-000000000001';
const MOM = 'b0000000-0000-4000-8000-000000000002';

const dinner = (id: string) => ({
  groupId: G,
  id,
  description: 'Dinner',
  amountPaise: 600,
  expenseDate: '2026-10-01',
  payers: [{ memberId: ME, amountPaise: 600 }],
  splitInput: { type: 'equal' as const, memberIds: [ME, MOM] },
});
const eid = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A fake server: applies commands with the shared planner, like the real `api` function. */
function fakeServer() {
  let groups = new Map<string, GroupSnapshot>();
  let rev = 0;
  const state = {
    online: true,
    calls: [] as string[],
    refuse: null as null | { code: string },
  };
  const bump = (s: GroupSnapshot): GroupSnapshot => ({ ...s, rev: String(++rev) });
  const api: Api = {
    async run(commands: CommandRequest[]) {
      state.calls.push(`run:${commands.map((c) => c.op).join(',')}`);
      if (!state.online) throw new ApiError('OFFLINE');
      return commands.map((c): CommandResult => {
        if (state.refuse) return { requestId: c.requestId, ok: false, error: state.refuse as never };
        const cmd = c as Command;
        const gid = (cmd.op === 'group.create' ? cmd.input.id : cmd.input.groupId).toLowerCase();
        const planned = planCommand(groups.get(gid) ?? null, { userId: U1, now: 5, newId: () => 'x' }, cmd);
        if (!planned.ok) return { requestId: c.requestId, ok: false, error: planned.error };
        groups.set(gid, bump(applyPlan(groups.get(gid) ?? null, planned.plan)!));
        return { requestId: c.requestId, ok: true };
      });
    },
    async listGroups(known) {
      state.calls.push('listGroups');
      if (!state.online) throw new ApiError('OFFLINE');
      return [...groups.values()].map((s) => ({ id: s.group.id, rev: s.rev, ...(known[s.group.id] === s.rev ? {} : { snapshot: s }) }));
    },
    async getGroup(id, knownRev) {
      state.calls.push('getGroup');
      if (!state.online) throw new ApiError('OFFLINE');
      const s = groups.get(id);
      if (!s) return { status: 'FORBIDDEN' };
      return s.rev === knownRev ? { status: 'UNCHANGED' } : { status: 'OK', snapshot: s };
    },
    async listActivity() {
      return { entries: [], more: false };
    },
  };
  return { api, state, groups: () => groups, reset: () => (groups = new Map()) };
}

function sqlite(): SyncSqlite {
  const db = new Database(':memory:');
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, ...params) => db.prepare(sql).run(...params),
    getAllSync: <T,>(sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as T[],
  };
}

let ids = 0;
function setup(options: { persistence?: boolean } = {}) {
  const server = fakeServer();
  const db = sqlite();
  const persistence = options.persistence === false ? undefined : createSqlitePersistence(db);
  const store = new DataStore({
    api: server.api,
    persistence,
    network: { isOnline: () => server.state.online },
    newId: () => `c0000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    now: () => 1_000,
  });
  store.hydrate();
  return { server, store, db, persistence };
}

async function withGroup() {
  const t = setup();
  t.store.setUser(U1);
  const created = await t.store.run('group.create', { id: G, name: 'Goa', myMemberId: ME, myName: 'Asha', members: [{ id: MOM, name: 'Mom' }] });
  expect(created).toEqual({ ok: true, entityId: G, queued: false });
  return t;
}

describe('DataStore', () => {
  it('saves online: shows the server copy once confirmed', async () => {
    const { store, server } = await withGroup();
    const res = await store.run('expense.add', dinner(eid(1)));
    expect(res).toEqual({ ok: true, entityId: eid(1), queued: false });
    expect(store.group(G)!.expenses.map((e) => e.id)).toEqual([eid(1)]);
    expect(store.pendingStatus(eid(1))).toBeNull();
    expect(server.state.calls).toContain('getGroup');
  });

  it('returns validation errors without sending anything', async () => {
    const { store, server } = await withGroup();
    const before = server.state.calls.length;
    expect(await store.run('expense.add', { ...dinner(eid(1)), description: ' ' })).toEqual({
      ok: false,
      error: { code: 'DESCRIPTION_REQUIRED' },
    });
    expect(server.state.calls.length).toBe(before);
  });

  it('queues new expenses offline, shows them as not sent, and sends them on reconnect in order', async () => {
    const { store, server } = await withGroup();
    server.state.online = false;
    expect(await store.run('expense.add', dinner(eid(1)))).toEqual({ ok: true, entityId: eid(1), queued: true });
    expect(await store.run('expense.add', dinner(eid(2)))).toEqual({ ok: true, entityId: eid(2), queued: true });
    expect(store.pendingStatus(eid(1))).toBe('queued');
    expect(store.group(G)!.expenses).toHaveLength(2);
    expect(store.getStatus().queued).toBe(2);

    // Edits need a connection.
    expect(await store.run('group.update', { groupId: G, expectedVersion: 1, name: 'Goa!' })).toEqual({ ok: false, error: { code: 'OFFLINE' } });

    server.state.online = true;
    await store.flush();
    expect(store.getStatus().queued).toBe(0);
    expect(server.groups().get(G)!.expenses).toHaveLength(2);
    expect(store.pendingStatus(eid(2))).toBeNull();
  });

  it('keeps a change the server refused, for the person to retry or discard', async () => {
    const { store, server } = await withGroup();
    server.state.online = false;
    await store.run('expense.add', dinner(eid(1)));
    server.state.online = true;
    server.state.refuse = { code: 'UNKNOWN_MEMBER' };
    await store.flush();
    expect(store.getStatus().failed).toBe(1);
    expect(store.pendingOps(G)[0]).toEqual(expect.objectContaining({ status: 'failed', error: { code: 'UNKNOWN_MEMBER' } }));
    expect(store.group(G)!.expenses).toHaveLength(0); // not shown as if saved

    server.state.refuse = null;
    store.retryOp(store.pendingOps(G)[0]!.requestId);
    await store.flush();
    expect(store.getStatus().failed).toBe(0);
    expect(store.group(G)!.expenses).toHaveLength(1);
  });

  it('remembers the cache and the queue across launches', async () => {
    const t = await withGroup();
    t.server.state.online = false;
    await t.store.run('expense.add', dinner(eid(1)));

    const again = new DataStore({ api: t.server.api, persistence: t.persistence, network: { isOnline: () => t.server.state.online } });
    again.hydrate();
    expect(again.getUserId()).toBe(U1);
    expect(again.group(G)!.group.name).toBe('Goa');
    expect(again.getStatus().queued).toBe(1);
    expect(again.group(G)!.expenses).toHaveLength(1);
  });

  it('works before the account exists (first launch offline), then sends as the new account', async () => {
    const t = setup();
    t.server.state.online = false;
    expect(t.store.planningUserId()).toBe(PENDING_USER);
    const res = await t.store.run('group.create', { id: G, name: 'Goa', myMemberId: ME, myName: 'Asha' });
    expect(res).toEqual({ ok: true, entityId: G, queued: true });
    expect(t.store.groups().map((g) => g.group.id)).toEqual([G]);

    t.server.state.online = true;
    t.store.setUser(U1);
    await t.store.flush();
    expect(t.server.groups().get(G)!.members[0]!.userId).toBe(U1);
    expect(t.store.groups()).toHaveLength(1);
  });

  it('drops groups the server no longer shows me, and clears everything for another account', async () => {
    const t = await withGroup();
    t.server.reset();
    await t.store.refreshAll();
    expect(t.store.groups()).toEqual([]);

    const u = await withGroup();
    u.store.setUser(U2);
    expect(u.store.groups()).toEqual([]);
  });

  it('only refetches what changed', async () => {
    const t = await withGroup();
    await t.store.refreshAll();
    const before = t.store.group(G);
    await t.store.refreshAll();
    expect(t.store.group(G)).toBe(before);
  });

  it('without a place to keep a queue (web), offline saves fail instead of waiting', async () => {
    const t = setup({ persistence: false });
    t.store.setUser(U1);
    await t.store.run('group.create', { id: G, name: 'Goa', myMemberId: ME, myName: 'Asha', members: [{ id: MOM, name: 'Mom' }] });
    t.server.state.online = false;
    expect(await t.store.run('expense.add', dinner(eid(1)))).toEqual({ ok: false, error: { code: 'OFFLINE' } });
    expect(t.store.group(G)!.expenses).toEqual([]);
  });
});
