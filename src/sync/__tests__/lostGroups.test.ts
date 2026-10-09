import { and, eq } from 'drizzle-orm';

import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense } from '@/db/repositories/expenses';
import { createGroup, renameGroup } from '@/db/repositories/groups';
import { activeMembersQuery, addMember, renameMember } from '@/db/repositories/members';
import { setMemberUpiVpa } from '@/db/repositories/memberUpi';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { recordSettlement } from '@/db/repositories/settlements';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  settings,
  settlements,
} from '@/db/schema';

import { getLostGroupIds, getSyncIssues, SYNC_ISSUES_KEY, SYNC_LOST_GROUPS_KEY } from '../engine';
import { forgetGroupLocally } from '../lostGroups';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Trip',
    selfName: 'Asha',
    otherMemberNames: ['Rahul'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error('group failed');
  const { groupId, selfMemberId: me } = created.value;
  const rahul = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Rahul')!.id;
  const expense = createExpense(t.ctx, {
    groupId,
    description: 'Dinner',
    amountPaise: 60000,
    expenseDate: '2026-10-01',
    payers: [{ memberId: me, amountPaise: 60000 }],
    splitInput: { type: 'equal', memberIds: [me, rahul] },
    actorMemberId: me,
  });
  if (!expense.ok) throw new Error('expense failed');
  const settled = recordSettlement(t.ctx, {
    groupId,
    fromMemberId: rahul,
    toMemberId: me,
    amountPaise: 10000,
    method: 'cash',
    actorMemberId: me,
  });
  if (!settled.ok) throw new Error('settlement failed');
  return { groupId, me, rahul, expenseId: expense.value.expenseId };
}

const setSetting = (key: string, value: unknown) =>
  t.ctx.db
    .insert(settings)
    .values({ key, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } })
    .run();

const markLost = (groupId: string) => setSetting(SYNC_LOST_GROUPS_KEY, [groupId]);

const countFor = (groupId: string) => ({
  groups: t.ctx.db.select().from(groups).where(eq(groups.id, groupId)).all().length,
  members: t.ctx.db.select().from(members).where(eq(members.groupId, groupId)).all().length,
  expenses: t.ctx.db.select().from(expenses).where(eq(expenses.groupId, groupId)).all().length,
  settlements: t.ctx.db.select().from(settlements).where(eq(settlements.groupId, groupId)).all().length,
  activity: t.ctx.db.select().from(activityLog).where(eq(activityLog.groupId, groupId)).all().length,
});

describe('lost groups are read-only', () => {
  it('refuses every kind of change, and allows them again once access is back', () => {
    const g = setup();
    markLost(g.groupId);

    const expense = () =>
      createExpense(t.ctx, {
        groupId: g.groupId,
        description: 'Taxi',
        amountPaise: 20000,
        expenseDate: '2026-10-02',
        payers: [{ memberId: g.me, amountPaise: 20000 }],
        splitInput: { type: 'equal', memberIds: [g.me, g.rahul] },
        actorMemberId: g.me,
      });

    expect(expense()).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    expect(
      recordSettlement(t.ctx, {
        groupId: g.groupId,
        fromMemberId: g.rahul,
        toMemberId: g.me,
        amountPaise: 100,
        method: 'cash',
        actorMemberId: g.me,
      }).ok,
    ).toBe(false);
    expect(addMember(t.ctx, { groupId: g.groupId, displayName: 'Priya', actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
    expect(renameMember(t.ctx, { memberId: g.rahul, displayName: 'Rahul K', actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
    expect(renameGroup(t.ctx, { groupId: g.groupId, name: 'Goa', actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
    expect(setMemberUpiVpa(t.ctx, { memberId: g.me, vpaInput: 'asha@ybl', actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });

    setSetting(SYNC_LOST_GROUPS_KEY, []); // added back: the next sync clears the flag
    expect(expense().ok).toBe(true);
  });
});

describe('forgetGroupLocally', () => {
  it('deletes a lost group and everything in it, plus its sync issues', () => {
    const g = setup();
    setSetting(SYNC_ISSUES_KEY, [
      { kind: 'rejected', table: 'expenses', id: g.expenseId, code: 'FORBIDDEN', detectedAt: 1 },
      { kind: 'rejected', table: 'groups', id: 'other-group', code: 'FORBIDDEN', detectedAt: 1 },
    ]);
    markLost(g.groupId);

    expect(forgetGroupLocally(t.ctx, g.groupId)).toEqual({ ok: true, value: undefined });

    expect(countFor(g.groupId)).toEqual({ groups: 0, members: 0, expenses: 0, settlements: 0, activity: 0 });
    expect(t.ctx.db.select().from(expensePayers).where(eq(expensePayers.expenseId, g.expenseId)).all()).toEqual([]);
    expect(t.ctx.db.select().from(expenseShares).where(eq(expenseShares.expenseId, g.expenseId)).all()).toEqual([]);
    expect(getLostGroupIds(t.ctx)).toEqual([]);
    expect(getSyncIssues(t.ctx).map((i) => i.id)).toEqual(['other-group']);
  });

  it('refuses to forget a group this phone can still access', () => {
    const g = setup();
    expect(forgetGroupLocally(t.ctx, g.groupId)).toEqual({ ok: false, error: { code: 'NOT_LOST' } });
    expect(
      t.ctx.db.select().from(members).where(and(eq(members.groupId, g.groupId))).all(),
    ).toHaveLength(2);
  });
});