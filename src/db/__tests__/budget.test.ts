import { createExpense } from '../repositories/expenses';
import {
  createGroup,
  getGroup,
  groupBudgetStatus,
  setGroupBudget,
  setGroupCurrency,
} from '../repositories/groups';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import { activityLog } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;
beforeEach(() => {
  t = createTestContext();
});
afterEach(() => t.close());

function setup(currency?: string) {
  const created = createGroup(t.ctx, {
    name: 'Goa',
    selfName: 'Asha',
    otherMemberNames: [],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
    ...(currency ? { currency } : {}),
  });
  if (!created.ok) throw new Error('group');
  return created.value;
}

function spend(groupId: string, me: string, amountPaise: number, expenseDate: string) {
  const result = createExpense(t.ctx, {
    groupId,
    description: 'Spend',
    amountPaise,
    expenseDate,
    payers: [{ memberId: me, amountPaise }],
    splitInput: { type: 'equal', memberIds: [me] },
    actorMemberId: me,
  });
  if (!result.ok) throw new Error('expense');
  return result.value.expenseId;
}

describe('group budgets', () => {
  it('tracks a whole-trip budget against all expenses', () => {
    const { groupId, selfMemberId: me } = setup();
    expect(groupBudgetStatus(t.ctx.db, getGroup(t.ctx.db, groupId)!, '2026-10-10')).toBeNull();

    expect(
      setGroupBudget(t.ctx, {
        groupId,
        budget: { limit: 6_000_000, period: 'total' },
        actorMemberId: me,
      }).ok,
    ).toBe(true);
    spend(groupId, me, 2_000_000, '2026-09-28');
    spend(groupId, me, 2_200_000, '2026-10-02');
    expect(groupBudgetStatus(t.ctx.db, getGroup(t.ctx.db, groupId)!, '2026-10-10')).toMatchObject({
      spent: 4_200_000,
      remaining: 1_800_000,
      level: 'ok',
    });

    const log = t.ctx.db
      .select()
      .from(activityLog)
      .all()
      .find((l) => (l.after as { budget?: unknown })?.budget);
    expect(log?.after).toEqual({ budget: { limit: 6_000_000, period: 'total' } });
  });

  it('counts only this month for a monthly budget', () => {
    const { groupId, selfMemberId: me } = setup();
    setGroupBudget(t.ctx, {
      groupId,
      budget: { limit: 1_000_000, period: 'monthly' },
      actorMemberId: me,
    });
    spend(groupId, me, 900_000, '2026-09-30');
    spend(groupId, me, 850_000, '2026-10-31');
    expect(groupBudgetStatus(t.ctx.db, getGroup(t.ctx.db, groupId)!, '2026-10-10')).toMatchObject({
      spent: 850_000,
      level: 'near',
      month: '2026-10',
    });
  });

  it('refuses amounts over the currency cap and clears with null', () => {
    const { groupId, selfMemberId: me } = setup();
    expect(
      setGroupBudget(t.ctx, {
        groupId,
        budget: { limit: 1_000_000_001, period: 'total' },
        actorMemberId: me,
      }),
    ).toEqual({
      ok: false,
      error: { code: 'INVALID_BUDGET', max: 1_000_000_000 },
    });
    setGroupBudget(t.ctx, { groupId, budget: { limit: 500, period: 'total' }, actorMemberId: me });
    expect(setGroupBudget(t.ctx, { groupId, budget: null, actorMemberId: me }).ok).toBe(true);
    expect(getGroup(t.ctx.db, groupId)).toMatchObject({ budgetPaise: null, budgetPeriod: null });
  });

  it('is cleared when the currency changes', () => {
    const { groupId, selfMemberId: me } = setup();
    setGroupBudget(t.ctx, {
      groupId,
      budget: { limit: 5_000_000, period: 'total' },
      actorMemberId: me,
    });
    expect(setGroupCurrency(t.ctx, { groupId, currency: 'THB', actorMemberId: me }).ok).toBe(true);
    expect(getGroup(t.ctx.db, groupId)).toMatchObject({
      currency: 'THB',
      budgetPaise: null,
      budgetPeriod: null,
    });
  });
});
