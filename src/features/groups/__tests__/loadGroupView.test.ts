import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense } from '@/db/repositories/expenses';
import { createGroup } from '@/db/repositories/groups';
import { recordSettlement } from '@/db/repositories/settlements';
import { activeMembersQuery } from '@/db/repositories/members';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';

import { dateLabel, loadGroupView, withDateHeaders, type HistoryRow } from '../loadGroupView';

describe('dateLabel', () => {
  it('names today and yesterday, otherwise formats the date', () => {
    expect(dateLabel('2026-10-10', '2026-10-10')).toBe('Today');
    expect(dateLabel('2026-10-09', '2026-10-10')).toBe('Yesterday');
    expect(dateLabel('2026-09-30', '2026-10-01')).toBe('Yesterday'); // across a month boundary
    expect(dateLabel('2025-12-31', '2026-01-01')).toBe('Yesterday'); // and a year boundary
    expect(dateLabel('2026-10-07', '2026-10-10')).toBe('7 Oct 2026');
  });
});

describe('withDateHeaders', () => {
  const row = (key: string, date: string) =>
    ({ kind: 'settlement', key, date, createdAt: 0, settlement: {} }) as unknown as Exclude<HistoryRow, { kind: 'date' }>;

  it('adds one header per calendar day, in order', () => {
    const rows = withDateHeaders([row('a', '2026-10-10'), row('b', '2026-10-10'), row('c', '2026-10-08')], '2026-10-10');
    expect(rows.map((r) => (r.kind === 'date' ? `#${r.label}` : r.key))).toEqual([
      '#Today',
      'a',
      'b',
      '#8 Oct 2026',
      'c',
    ]);
  });

  it('returns nothing for no rows', () => {
    expect(withDateHeaders([], '2026-10-10')).toEqual([]);
  });
});

describe('loadGroupView', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });
  afterEach(() => t.close());

  it('builds history with headers, balances, my share and activity', () => {
    const deviceUserId = getOrCreateDeviceUserId(t.ctx);
    const created = createGroup(t.ctx, { name: 'Goa', selfName: 'Asha', otherMemberNames: ['Rahul'], deviceUserId });
    if (!created.ok) throw new Error('createGroup failed');
    const { groupId, selfMemberId: me } = created.value;
    const rahul = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Rahul')!.id;

    for (const [date, amount] of [
      ['2026-10-08', 40000],
      ['2026-10-10', 60000],
    ] as const) {
      const result = createExpense(t.ctx, {
        groupId,
        description: `Dinner ${date}`,
        amountPaise: amount,
        expenseDate: date,
        payers: [{ memberId: me, amountPaise: amount }],
        splitInput: { type: 'equal', memberIds: [me, rahul] },
        actorMemberId: me,
      });
      if (!result.ok) throw new Error('createExpense failed');
      t.advance(1000);
    }

    const view = loadGroupView(t.ctx.db, groupId, deviceUserId, '2026-10-10')!;
    expect(view.canEdit).toBe(true);
    expect(view.myBalance).toBe(50000);
    expect(view.expenseCount).toBe(2);
    expect(view.history.map((r) => (r.kind === 'date' ? r.label : r.kind))).toEqual([
      'Today',
      'expense',
      '8 Oct 2026',
      'expense',
    ]);
    const first = view.history[1]!;
    expect(first.kind === 'expense' && first.myNet).toBe(30000);
    expect(view.transfers).toEqual([{ fromMemberId: rahul, toMemberId: me, amountPaise: 50000 }]);
    expect(view.activeMembers.map((m) => m.name)).toEqual(['Asha', 'Rahul']);
    expect(view.activity.length).toBeGreaterThan(0);
  });

  it('folds everything up to the last settle-up away from the open history', () => {
    const deviceUserId = getOrCreateDeviceUserId(t.ctx);
    const created = createGroup(t.ctx, { name: 'Flat', selfName: 'Asha', otherMemberNames: ['Rahul'], deviceUserId });
    if (!created.ok) throw new Error('createGroup failed');
    const { groupId, selfMemberId: me } = created.value;
    const rahul = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Rahul')!.id;
    const add = (description: string, date: string, amount: number) => {
      const result = createExpense(t.ctx, {
        groupId,
        description,
        amountPaise: amount,
        expenseDate: date,
        payers: [{ memberId: me, amountPaise: amount }],
        splitInput: { type: 'equal', memberIds: [me, rahul] },
        actorMemberId: me,
      });
      if (!result.ok) throw new Error('createExpense failed');
      t.advance(1000);
    };

    add('Rent', '2026-10-01', 2000000);
    expect(loadGroupView(t.ctx.db, groupId, deviceUserId, '2026-10-10')!.settled).toBeNull();

    t.advance(1000);
    const paid = recordSettlement(t.ctx, {
      groupId,
      fromMemberId: rahul,
      toMemberId: me,
      amountPaise: 1000000,
      method: 'upi',
      actorMemberId: me,
    });
    if (!paid.ok) throw new Error('recordSettlement failed');
    t.advance(1000);

    const square = loadGroupView(t.ctx.db, groupId, deviceUserId, '2026-10-10')!;
    expect(square.history).toEqual([]);
    expect(square.settled).toMatchObject({ expenseCount: 1, total: 2000000 });
    // Both rows are folded away (their order follows the dates: the test clock's payment date).
    expect(square.settled!.history.filter((r) => r.kind !== 'date').map((r) => r.kind).sort()).toEqual(['expense', 'settlement']);

    add('Wi-Fi', '2026-12-05', 100000);
    const later = loadGroupView(t.ctx.db, groupId, deviceUserId, '2026-12-05')!;
    expect(later.history.filter((r) => r.kind === 'expense').map((r) => r.kind === 'expense' && r.expense.description)).toEqual(['Wi-Fi']);
    expect(later.settled!.expenseCount).toBe(1);
  });

  it('returns null for a missing group', () => {
    expect(loadGroupView(t.ctx.db, 'nope', 'device', '2026-10-10')).toBeNull();
  });
});
