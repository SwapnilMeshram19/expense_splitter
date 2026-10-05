import { eq } from 'drizzle-orm';

import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense } from '@/db/repositories/expenses';
import { createGroup, renameGroup } from '@/db/repositories/groups';
import { activeMembersQuery } from '@/db/repositories/members';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { activityLog, expenseShares, expenses, groups, members } from '@/db/schema';

import {
  applyPull,
  applyPushResult,
  collectPushBatch,
  getLostGroupIds,
  getSyncCursor,
  getSyncIssues,
  resolveConflict,
} from '../engine';
import { runSync, type SyncTransport } from '../runSync';
import { groupToWire, type PullResult, type PushBatch, type PushResult, type RowOutcome } from '../wire';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Goa',
    selfName: 'Asha',
    otherMemberNames: ['Mom'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const { groupId, selfMemberId: me } = created.value;
  const mom = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Mom')!.id;

  const expense = createExpense(t.ctx, {
    groupId,
    description: 'Dinner',
    amountPaise: 90000,
    expenseDate: '2026-10-01',
    payers: [{ memberId: me, amountPaise: 90000 }],
    splitInput: { type: 'equal', memberIds: [me, mom] },
    actorMemberId: me,
  });
  if (!expense.ok) throw new Error(JSON.stringify(expense.error));

  return { groupId, me, mom, expenseId: expense.value.expenseId };
}

/** What the server answers when every row applies: version = base_version + 1. */
function ackAll(batch: PushBatch): PushResult {
  const applied: RowOutcome[] = [
    ...batch.groups.map((r) => ({ table: 'groups' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.members.map((r) => ({ table: 'members' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.expenses.map((r) => ({ table: 'expenses' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.settlements.map((r) => ({ table: 'settlements' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.activity.map((r) => ({ table: 'activity' as const, id: r.id, version: null })),
  ];
  return { applied, conflicts: [], rejected: [] };
}

function pushAndAck() {
  const collected = collectPushBatch(t.ctx)!;
  applyPushResult(t.ctx, collected, ackAll(collected.batch));
}

const pull = (overrides: Partial<PullResult> = {}): PullResult => ({
  cursor: '100',
  group_ids: [],
  groups: [],
  members: [],
  expenses: [],
  settlements: [],
  activity: [],
  ...overrides,
});

const groupRow = (id: string) => t.ctx.db.select().from(groups).where(eq(groups.id, id)).get()!;

function remoteGroup(): Partial<PullResult> {
  const base = { created_at: 1, updated_at: 1, deleted_at: null, version: 1 };
  return {
    groups: [{ id: 'g-remote', name: 'Flat', simplify_debts: true, ...base }],
    members: [
      { id: 'm-r1', group_id: 'g-remote', display_name: 'Bala', user_id: 'user-bala', upi_vpa: null, ...base },
      { id: 'm-r2', group_id: 'g-remote', display_name: 'Chetan', user_id: null, upi_vpa: null, ...base },
    ],
    expenses: [
      {
        id: 'e-remote',
        group_id: 'g-remote',
        description: 'Rent',
        amount_paise: 2000000,
        category: 'utilities',
        expense_date: '2026-10-01',
        split_input: { type: 'equal', memberIds: ['m-r1', 'm-r2'] },
        created_by_member_id: 'm-r1',
        payers: [{ member_id: 'm-r1', amount_paise: 2000000 }],
        shares: [
          { member_id: 'm-r1', amount_paise: 1000000 },
          { member_id: 'm-r2', amount_paise: 1000000 },
        ],
        ...base,
      },
    ],
    settlements: [
      {
        id: 's-remote',
        group_id: 'g-remote',
        from_member_id: 'm-r2',
        to_member_id: 'm-r1',
        amount_paise: 500000,
        method: 'upi',
        note: null,
        settled_at: 2,
        created_by_member_id: 'm-r2',
        ...base,
      },
    ],
    activity: [
      {
        id: 'a-remote',
        group_id: 'g-remote',
        entity_type: 'expense',
        entity_id: 'e-remote',
        action: 'create',
        actor_member_id: 'm-r1',
        before: null,
        after: { description: 'Rent' },
        created_at: 1,
      },
    ],
  };
}

describe('collectPushBatch', () => {
  it('sends every dirty row with its base version, expense lines and history', () => {
    const g = setup();
    const collected = collectPushBatch(t.ctx)!;

    expect(collected.batch.groups).toHaveLength(1);
    expect(collected.batch.groups[0]!.base_version).toBe(0);
    expect(collected.batch.members).toHaveLength(2);
    expect(collected.batch.expenses[0]!.payers).toEqual([{ member_id: g.me, amount_paise: 90000 }]);
    expect(collected.batch.expenses[0]!.shares).toHaveLength(2);
    expect(collected.batch.activity).toHaveLength(2); // group created + expense created
    expect(collected.size).toBe(6);
  });

  it('returns null when nothing is pending', () => {
    expect(collectPushBatch(t.ctx)).toBeNull();
  });

  it('respects the row limit but keeps a new group together with its members', () => {
    setup();
    const collected = collectPushBatch(t.ctx, 1)!;

    expect(collected.batch.groups).toHaveLength(1);
    expect(collected.batch.members).toHaveLength(2);
    expect(collected.batch.expenses).toHaveLength(0);
  });
});

describe('applyPushResult', () => {
  it('clears dirty flags and stores server versions', () => {
    const g = setup();
    pushAndAck();

    expect(groupRow(g.groupId)).toMatchObject({ dirty: false, version: 1 });
    expect(t.ctx.db.select().from(expenses).where(eq(expenses.id, g.expenseId)).get()).toMatchObject({
      dirty: false,
      version: 1,
    });
    expect(t.ctx.db.select().from(activityLog).where(eq(activityLog.dirty, true)).all()).toHaveLength(0);
    expect(collectPushBatch(t.ctx)).toBeNull();
  });

  it('keeps a row dirty when it was edited while the push was in flight', () => {
    const g = setup();
    const collected = collectPushBatch(t.ctx)!;
    t.advance(1000);
    expect(renameGroup(t.ctx, { groupId: g.groupId, name: 'Goa 2026', actorMemberId: g.me }).ok).toBe(true);

    applyPushResult(t.ctx, collected, ackAll(collected.batch));

    expect(groupRow(g.groupId)).toMatchObject({ name: 'Goa 2026', dirty: true, version: 1 });
    const next = collectPushBatch(t.ctx)!;
    expect(next.batch.groups[0]).toMatchObject({ name: 'Goa 2026', base_version: 1 });
  });

  it('records conflicts and rejections, and stops resending those rows', () => {
    const g = setup();
    const collected = collectPushBatch(t.ctx)!;
    const acked = ackAll(collected.batch);

    applyPushResult(t.ctx, collected, {
      applied: acked.applied.filter((o) => o.id !== g.expenseId && o.id !== g.mom),
      conflicts: [{ table: 'expenses', id: g.expenseId, server_version: 3 }],
      rejected: [{ table: 'members', id: g.mom, code: 'FORBIDDEN' }],
    });

    expect(getSyncIssues(t.ctx).map((i) => [i.kind, i.table])).toEqual(
      expect.arrayContaining([
        ['conflict', 'expenses'],
        ['rejected', 'members'],
      ]),
    );
    expect(collectPushBatch(t.ctx)).toBeNull();
  });

  it('treats a missing-dependency rejection as retryable, not as an issue', () => {
    const g = setup();
    const collected = collectPushBatch(t.ctx)!;
    const acked = ackAll(collected.batch);

    applyPushResult(t.ctx, collected, {
      applied: acked.applied.filter((o) => o.id !== g.expenseId),
      conflicts: [],
      rejected: [{ table: 'expenses', id: g.expenseId, code: 'INVALID', detail: '23503' }],
    });

    expect(getSyncIssues(t.ctx)).toHaveLength(0);
    expect(collectPushBatch(t.ctx)!.batch.expenses).toHaveLength(1);
  });
});

describe('applyPull', () => {
  it('inserts a new remote group as clean, synced rows', () => {
    const stats = applyPull(t.ctx, pull({ group_ids: ['g-remote'], ...remoteGroup() }));

    expect(stats.written).toBe(6);
    expect(groupRow('g-remote')).toMatchObject({ name: 'Flat', dirty: false, version: 1 });
    expect(t.ctx.db.select().from(members).where(eq(members.groupId, 'g-remote')).all()).toHaveLength(2);
    expect(t.ctx.db.select().from(expenseShares).where(eq(expenseShares.expenseId, 'e-remote')).all()).toHaveLength(2);
    expect(t.ctx.db.select().from(activityLog).where(eq(activityLog.id, 'a-remote')).get()?.dirty).toBe(false);
    expect(getSyncCursor(t.ctx)).toBe('100');
    expect(collectPushBatch(t.ctx)).toBeNull(); // pulled rows are never pushed back
  });

  it('overwrites clean rows only with a newer server version', () => {
    const g = setup();
    pushAndAck();
    const server = { ...groupToWire(groupRow(g.groupId)), group_ids: undefined };

    applyPull(t.ctx, pull({ group_ids: [g.groupId], groups: [{ ...server, name: 'Stale', version: 1 }] }));
    expect(groupRow(g.groupId).name).toBe('Goa');

    applyPull(t.ctx, pull({ group_ids: [g.groupId], groups: [{ ...server, name: 'Goa 2026', version: 2 }] }));
    expect(groupRow(g.groupId)).toMatchObject({ name: 'Goa 2026', version: 2, dirty: false });
  });

  it('never overwrites an unpushed local edit: records a conflict with the server copy', () => {
    const g = setup();
    pushAndAck();
    renameGroup(t.ctx, { groupId: g.groupId, name: 'Mine', actorMemberId: g.me });
    const server = { ...groupToWire(groupRow(g.groupId)), name: 'Theirs', version: 2 };

    const stats = applyPull(t.ctx, pull({ group_ids: [g.groupId], groups: [server] }));

    expect(stats.conflicts).toBe(1);
    expect(groupRow(g.groupId)).toMatchObject({ name: 'Mine', dirty: true, version: 1 });
    expect(getSyncIssues(t.ctx)[0]).toMatchObject({ kind: 'conflict', table: 'groups', serverVersion: 2 });
  });

  it('resolves a conflict with the server copy (keep theirs)', () => {
    const g = setup();
    pushAndAck();
    renameGroup(t.ctx, { groupId: g.groupId, name: 'Mine', actorMemberId: g.me });
    applyPull(t.ctx, pull({
      group_ids: [g.groupId],
      groups: [{ ...groupToWire(groupRow(g.groupId)), name: 'Theirs', version: 2 }],
    }));

    expect(resolveConflict(t.ctx, 'groups', g.groupId, 'theirs').ok).toBe(true);

    expect(groupRow(g.groupId)).toMatchObject({ name: 'Theirs', dirty: false, version: 2 });
    expect(getSyncIssues(t.ctx)).toHaveLength(0);
  });

  it('resolves a conflict with the local edit (keep mine) on top of the server version', () => {
    const g = setup();
    pushAndAck();
    renameGroup(t.ctx, { groupId: g.groupId, name: 'Mine', actorMemberId: g.me });
    applyPull(t.ctx, pull({
      group_ids: [g.groupId],
      groups: [{ ...groupToWire(groupRow(g.groupId)), name: 'Theirs', version: 2 }],
    }));

    expect(resolveConflict(t.ctx, 'groups', g.groupId, 'mine').ok).toBe(true);

    expect(groupRow(g.groupId)).toMatchObject({ name: 'Mine', dirty: true, version: 2 });
    expect(collectPushBatch(t.ctx)!.batch.groups[0]).toMatchObject({ name: 'Mine', base_version: 2 });
  });

  it('adopts the server copy silently when it matches the local edit (lost push response)', () => {
    const g = setup();
    pushAndAck();
    renameGroup(t.ctx, { groupId: g.groupId, name: 'Goa 2026', actorMemberId: g.me });
    const sameAsLocal = { ...groupToWire(groupRow(g.groupId)), version: 2 };

    applyPull(t.ctx, pull({ group_ids: [g.groupId], groups: [sameAsLocal] }));

    expect(groupRow(g.groupId)).toMatchObject({ name: 'Goa 2026', dirty: false, version: 2 });
    expect(getSyncIssues(t.ctx)).toHaveLength(0);
  });

  it('defers rows of groups this phone does not have yet', () => {
    const remote = remoteGroup();
    applyPull(t.ctx, pull({ group_ids: ['g-remote'], members: remote.members }));

    expect(t.ctx.db.select().from(members).where(eq(members.groupId, 'g-remote')).all()).toHaveLength(0);
  });

  it('reports synced groups that are no longer visible', () => {
    const g = setup();
    pushAndAck();

    applyPull(t.ctx, pull({ group_ids: [] }));
    expect(getLostGroupIds(t.ctx)).toEqual([g.groupId]);

    applyPull(t.ctx, pull({ group_ids: [g.groupId] }));
    expect(getLostGroupIds(t.ctx)).toEqual([]);
  });
});

describe('runSync', () => {
  it('pushes, pulls, then full-fetches groups it has not seen', async () => {
    const g = setup();
    const pulls: [string | null, string[]][] = [];
    const transport: SyncTransport = {
      push: async (batch) => ackAll(batch),
      pull: async (cursor, full) => {
        pulls.push([cursor, full]);
        return full.length === 0
          ? pull({ cursor: '100', group_ids: [g.groupId, 'g-remote'] })
          : pull({ cursor: '101', group_ids: [g.groupId, 'g-remote'], ...remoteGroup() });
      },
    };

    const report = await runSync(t.ctx, transport);

    expect(report.pushed).toBe(6);
    expect(pulls).toEqual([
      [null, []],
      ['100', ['g-remote']],
    ]);
    expect(groupRow('g-remote').name).toBe('Flat');
    expect(getSyncCursor(t.ctx)).toBe('101');
    expect(collectPushBatch(t.ctx)).toBeNull();
  });
});