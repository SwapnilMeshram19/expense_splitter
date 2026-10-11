import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense, deleteExpense } from '@/db/repositories/expenses';
import { createGroup, setGroupBudget } from '@/db/repositories/groups';
import { activeMembersQuery } from '@/db/repositories/members';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { recordSettlement } from '@/db/repositories/settlements';
import { expenseShares } from '@/db/schema';
import { eq } from 'drizzle-orm';

import { computeInsights } from '../compute';
import { buildExpensesCsv } from '../csv';
import { loadInsightsSource } from '../loadInsights';

describe('loadInsightsSource', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });
  afterEach(() => t.close());

  function setup() {
    const deviceUserId = getOrCreateDeviceUserId(t.ctx);
    const created = createGroup(t.ctx, {
      name: 'Flat 302',
      selfName: 'Asha',
      otherMemberNames: ['Rahul'],
      deviceUserId,
    });
    if (!created.ok) throw new Error('createGroup failed');
    const { groupId, selfMemberId: me } = created.value;
    const rahul = activeMembersQuery(t.ctx.db, groupId)
      .all()
      .find((m) => m.displayName === 'Rahul')!.id;
    const add = (date: string, amount: number, category: 'food' | 'stay' = 'food') => {
      const result = createExpense(t.ctx, {
        groupId,
        description: `${category} ${date}`,
        amountPaise: amount,
        category,
        expenseDate: date,
        payers: [{ memberId: me, amountPaise: amount }],
        splitInput: { type: 'equal', memberIds: [me, rahul] },
        actorMemberId: me,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.error));
      t.advance(1000);
      return result.value.expenseId;
    };
    return { deviceUserId, groupId, me, rahul, add };
  }

  it('reads expenses oldest first, payments, balances and budget', () => {
    const g = setup();
    g.add('2026-09-10', 300000, 'stay');
    g.add('2026-10-02', 40000);
    const removed = g.add('2026-10-03', 99900);
    expect(deleteExpense(t.ctx, removed, g.me).ok).toBe(true);
    expect(
      recordSettlement(t.ctx, {
        groupId: g.groupId,
        fromMemberId: g.rahul,
        toMemberId: g.me,
        amountPaise: 20000,
        method: 'cash',
        actorMemberId: g.me,
      }).ok,
    ).toBe(true);
    expect(
      setGroupBudget(t.ctx, {
        groupId: g.groupId,
        budget: { limit: 50000, period: 'monthly' },
        actorMemberId: g.me,
      }).ok,
    ).toBe(true);

    const source = loadInsightsSource(t.ctx.db, g.groupId, g.deviceUserId, '2026-10-11')!;
    expect(source.me).toBe(g.me);
    expect(source.expenses.map((e) => e.date)).toEqual(['2026-09-10', '2026-10-02']);
    expect(source.expenses[0]!.shares.map((s) => s.amountPaise)).toEqual([150000, 150000]);
    expect(source.settlements).toHaveLength(1);
    expect(source.balances.get(g.me)).toBe(150000);
    expect(source.budget).toMatchObject({ spent: 40000, period: 'monthly' });
    expect(source.invalidCount).toBe(0);

    const insights = computeInsights(source.expenses, source.members, {
      scope: 'mine',
      me: source.me,
      period: null,
      today: '2026-10-11',
    });
    expect(insights.summary.total).toBe(170000);
    expect(insights.months.map((m) => m.total)).toEqual([150000, 20000]);
    expect(insights.categories.map((c) => c.name)).toEqual(['Stay', 'Food & drinks']);

    // The CSV's balance row is the app's balances.
    const csv = buildExpensesCsv({
      currency: 'INR',
      members: source.members,
      expenses: source.expenses,
      settlements: source.settlements,
      period: null,
    });
    const last = csv.trimEnd().split('\r\n').pop()!.split(',');
    expect(last.slice(-2)).toEqual(['1500.00', '-1500.00']);
  });

  it('leaves out expenses whose lines do not add up', () => {
    const g = setup();
    const bad = g.add('2026-10-02', 40000);
    g.add('2026-10-03', 1000);
    t.ctx.db.delete(expenseShares).where(eq(expenseShares.expenseId, bad)).run();

    const source = loadInsightsSource(t.ctx.db, g.groupId, g.deviceUserId, '2026-10-11')!;
    expect(source.invalidCount).toBe(1);
    expect(source.expenses).toHaveLength(1);
  });

  it('returns null for a missing group', () => {
    expect(loadInsightsSource(t.ctx.db, 'nope', 'device', '2026-10-11')).toBeNull();
  });
});
