import type { GroupSnapshot } from '@/domain/model';
import { testGroup } from '@/test-utils/groupBuilder';

import { computeInsights } from '../compute';
import { buildExpensesCsv } from '../csv';
import { loadInsightsSource } from '../loadInsights';

describe('loadInsightsSource', () => {
  function setup() {
    const t = testGroup({ name: 'Flat 302', me: 'Asha', others: ['Rahul'] });
    const me = t.me;
    const rahul = t.member('Rahul');
    const add = (date: string, amount: number, category: 'food' | 'stay' = 'food') => {
      const id = t.run('expense.add', {
        id: t.newId(),
        description: `${category} ${date}`,
        amountPaise: amount,
        category,
        expenseDate: date,
        payers: [{ memberId: me, amountPaise: amount }],
        splitInput: { type: 'equal', memberIds: [me, rahul] },
      });
      t.advance(1000);
      return id;
    };
    return { t, userId: t.userId, groupId: t.groupId, me, rahul, add };
  }

  it('reads expenses oldest first, payments, balances and budget', () => {
    const g = setup();
    g.add('2026-09-10', 300000, 'stay');
    g.add('2026-10-02', 40000);
    const removed = g.add('2026-10-03', 99900);
    g.t.run('expense.delete', { expenseId: removed, expectedVersion: g.t.versionOf(removed) });
    g.t.run('settlement.add', {
      id: g.t.newId(),
      fromMemberId: g.rahul,
      toMemberId: g.me,
      amountPaise: 20000,
      method: 'cash',
    });
    g.t.run('group.update', {
      expectedVersion: g.t.versionOf(g.groupId),
      budget: { limit: 50000, period: 'monthly' },
    });

    const source = loadInsightsSource(g.t.snapshot(), g.userId, '2026-10-11')!;
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
    const snapshot = g.t.snapshot();
    // A row that arrived broken (its shares are missing): never trusted, never charted.
    const broken: GroupSnapshot = {
      ...snapshot,
      expenses: snapshot.expenses.map((e) => (e.id === bad ? { ...e, shares: [] } : e)),
    };

    const source = loadInsightsSource(broken, g.userId, '2026-10-11')!;
    expect(source.invalidCount).toBe(1);
    expect(source.expenses).toHaveLength(1);
  });

  it('returns null for a missing group', () => {
    expect(loadInsightsSource(null, 'user', '2026-10-11')).toBeNull();
  });
});
