import { and, asc, eq } from 'drizzle-orm';

import { computeBalances } from '@/domain/balances';

import { createExpense, deleteExpense, getExpense, updateExpense, type ExpenseDraft } from '../repositories/expenses';
import { createGroup } from '../repositories/groups';
import { loadGroupLedger } from '../repositories/ledger';
import { activeMembersQuery, addMember, renameMember } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import { activityLog, expenses, members } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function setupGroup() {
  const deviceUserId = getOrCreateDeviceUserId(t.ctx);
  const result = createGroup(t.ctx, {
    name: '  Goa   Trip ',
    selfName: 'Asha',
    otherMemberNames: ['Rahul', 'Priya'],
    deviceUserId,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));

  const rows = activeMembersQuery(t.ctx.db, result.value.groupId).all();
  const idOf = (name: string) => rows.find((m) => m.displayName === name)!.id;

  return {
    deviceUserId,
    groupId: result.value.groupId,
    me: result.value.selfMemberId,
    rahul: idOf('Rahul'),
    priya: idOf('Priya'),
  };
}

type Setup = ReturnType<typeof setupGroup>;

const dinner = (g: Setup, overrides: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  groupId: g.groupId,
  description: 'Dinner',
  amountPaise: 90000,
  expenseDate: '2026-10-01',
  payers: [{ memberId: g.me, amountPaise: 90000 }],
  splitInput: { type: 'equal', memberIds: [g.me, g.rahul, g.priya] },
  actorMemberId: g.me,
  ...overrides,
});

const balancesOf = (groupId: string) => {
  const ledger = loadGroupLedger(t.ctx.db, groupId);
  return computeBalances(ledger.expenses, ledger.settlements).balances;
};

describe('profile', () => {
  it('returns a stable device user id', () => {
    const first = getOrCreateDeviceUserId(t.ctx);
    expect(getOrCreateDeviceUserId(t.ctx)).toBe(first);
  });
});

describe('groups and members', () => {
  it('creates a group with a self member and placeholders, atomically logged', () => {
    const g = setupGroup();
    const rows = activeMembersQuery(t.ctx.db, g.groupId).all();

    expect(rows.map((m) => m.displayName)).toEqual(['Asha', 'Rahul', 'Priya']);
    expect(rows.find((m) => m.id === g.me)?.userId).toBe(g.deviceUserId);
    expect(rows.filter((m) => m.userId === null)).toHaveLength(2);

    const log = t.ctx.db.select().from(activityLog).where(eq(activityLog.entityType, 'group')).all();
    expect(log).toHaveLength(1);
    expect(log[0]?.after).toEqual({ name: 'Goa Trip', members: ['Asha', 'Rahul', 'Priya'], currency: 'INR' });
  });

  it('rejects blank and duplicate names (case-insensitive)', () => {
    const deviceUserId = getOrCreateDeviceUserId(t.ctx);
    expect(
      createGroup(t.ctx, { name: '  ', selfName: 'Asha', otherMemberNames: [], deviceUserId }),
    ).toEqual({ ok: false, error: { target: 'group', error: { code: 'NAME_REQUIRED' } } });
    expect(
      createGroup(t.ctx, {
        name: 'Trip',
        selfName: 'Asha',
        otherMemberNames: ['Rahul', 'rahul'],
        deviceUserId,
      }),
    ).toEqual({
      ok: false,
      error: { target: 'member', error: { code: 'DUPLICATE_NAME', name: 'rahul' } },
    });
  });

  it('adds and renames members with duplicate checks', () => {
    const g = setupGroup();

    const added = addMember(t.ctx, { groupId: g.groupId, displayName: ' Neha ', actorMemberId: g.me });
    expect(added.ok).toBe(true);
    expect(
      addMember(t.ctx, { groupId: g.groupId, displayName: 'RAHUL', actorMemberId: g.me }),
    ).toEqual({ ok: false, error: { code: 'DUPLICATE_NAME', name: 'RAHUL' } });
    expect(
      addMember(t.ctx, { groupId: 'missing', displayName: 'X', actorMemberId: g.me }),
    ).toEqual({ ok: false, error: { code: 'GROUP_NOT_FOUND' } });

    expect(renameMember(t.ctx, { memberId: g.rahul, displayName: 'Rahul K', actorMemberId: g.me })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(renameMember(t.ctx, { memberId: g.rahul, displayName: 'priya', actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_NAME', name: 'priya' },
    });
  });
});

describe('expenses', () => {
  it('creates an expense with lines and feeds balances', () => {
    const g = setupGroup();
    const created = createExpense(t.ctx, dinner(g));
    if (!created.ok) throw new Error(JSON.stringify(created.error));

    const detail = getExpense(t.ctx.db, created.value.expenseId);
    expect(detail?.expense.version).toBe(0);
    expect(detail?.expense.dirty).toBe(true);
    expect(detail?.shares.map((s) => s.amountPaise)).toEqual([30000, 30000, 30000]);

    const balances = balancesOf(g.groupId);
    expect(balances.get(g.me)).toBe(60000);
    expect(balances.get(g.rahul)).toBe(-30000);
    expect(balances.get(g.priya)).toBe(-30000);
  });

  it('rejects invalid expenses and writes nothing', () => {
    const g = setupGroup();
    expect(
      createExpense(t.ctx, dinner(g, { splitInput: { type: 'equal', memberIds: [g.me, 'stranger'] } })),
    ).toEqual({ ok: false, error: { code: 'UNKNOWN_MEMBER', memberId: 'stranger' } });
    expect(createExpense(t.ctx, dinner(g, { actorMemberId: 'stranger' }))).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
    expect(t.ctx.db.select().from(expenses).all()).toHaveLength(0);
  });

  it('updates an expense, rewrites lines, keeps version and logs before/after', () => {
    const g = setupGroup();
    const created = createExpense(t.ctx, dinner(g));
    if (!created.ok) throw new Error('create failed');
    const id = created.value.expenseId;

    t.advance(1000);
    const updated = updateExpense(
      t.ctx,
      id,
      dinner(g, {
        amountPaise: 60000,
        payers: [{ memberId: g.rahul, amountPaise: 60000 }],
        splitInput: { type: 'equal', memberIds: [g.me, g.rahul] },
      }),
    );
    expect(updated).toEqual({ ok: true, value: undefined });

    const detail = getExpense(t.ctx.db, id);
    expect(detail?.expense.version).toBe(0);
    expect(detail?.shares).toHaveLength(2);

    const balances = balancesOf(g.groupId);
    expect(balances.get(g.rahul)).toBe(30000);
    expect(balances.get(g.me)).toBe(-30000);

    const log = t.ctx.db
      .select()
      .from(activityLog)
      .where(and(eq(activityLog.entityId, id)))
      .orderBy(asc(activityLog.createdAt))
      .all();
    expect(log.map((l) => l.action)).toEqual(['create', 'update']);
    expect((log[1]?.before as { amountPaise: number }).amountPaise).toBe(90000);
    expect((log[1]?.after as { amountPaise: number }).amountPaise).toBe(60000);
  });

  it('soft-deletes an expense and removes it from balances', () => {
    const g = setupGroup();
    const created = createExpense(t.ctx, dinner(g));
    if (!created.ok) throw new Error('create failed');
    const id = created.value.expenseId;

    expect(deleteExpense(t.ctx, id, g.me)).toEqual({ ok: true, value: undefined });
    expect(getExpense(t.ctx.db, id)?.expense.deletedAt).not.toBeNull();
    expect(balancesOf(g.groupId).size).toBe(0);
    expect(deleteExpense(t.ctx, id, g.me)).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(updateExpense(t.ctx, id, dinner(g))).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});

describe('database constraints (last line of defense)', () => {
  it('rejects a non-positive amount even when bypassing the repository', () => {
    const g = setupGroup();
    expect(() =>
      t.ctx.db
        .insert(expenses)
        .values({
          id: 'bad',
          groupId: g.groupId,
          description: 'Bad',
          amountPaise: 0,
          expenseDate: '2026-10-01',
          splitInput: { type: 'equal', memberIds: [g.me] },
          createdByMemberId: g.me,
        })
        .run(),
    ).toThrow();
  });

  it('enforces foreign keys', () => {
    expect(() =>
      t.ctx.db.insert(members).values({ id: 'm', groupId: 'no-such-group', displayName: 'X' }).run(),
    ).toThrow();
  });
});