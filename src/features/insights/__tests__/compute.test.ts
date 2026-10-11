import {
  addMonths,
  amountFor,
  categoryTotals,
  chartMonths,
  computeInsights,
  memberTotals,
  monthLabel,
  monthlyTotals,
  monthRange,
  percentages,
  summarize,
  type InsightMember,
} from '../compute';

import { expense } from './fixtures';

const members: InsightMember[] = [
  { id: 'me', name: 'Asha', active: true },
  { id: 'rahul', name: 'Rahul', active: true },
  { id: 'old', name: 'Vikram', active: false },
];

describe('months', () => {
  it('adds months across years both ways', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', -12)).toBe('2025-10');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
  });

  it('lists a range inclusively', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-03', '2026-02')).toEqual([]);
  });

  it('labels months', () => {
    expect(monthLabel('2026-10')).toBe('Oct 2026');
    expect(monthLabel('2026-01', 'long')).toBe('January 2026');
    expect(monthLabel('bad')).toBe('bad');
  });
});

describe('chartMonths', () => {
  it('runs from the first expense to this month, keeping empty months', () => {
    const list = [expense('2026-08-10', 100), expense('2026-06-01', 100)];
    expect(chartMonths(list, '2026-10-11')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
  });

  it('caps at 12 months and follows a bill dated ahead', () => {
    const list = [expense('2024-01-01', 100), expense('2026-12-05', 100)];
    const months = chartMonths(list, '2026-10-11');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-01');
    expect(months[11]).toBe('2026-12');
  });

  it('is empty without expenses', () => {
    expect(chartMonths([], '2026-10-11')).toEqual([]);
  });
});

describe('amounts by scope', () => {
  const bill = expense('2026-10-01', 90000, {
    split: { me: 30000, rahul: 60000 },
    paidBy: { rahul: 90000 },
  });

  it('counts the bill for the group and my share for me', () => {
    expect(amountFor(bill, 'group', 'me')).toBe(90000);
    expect(amountFor(bill, 'mine', 'me')).toBe(30000);
    expect(amountFor(bill, 'mine', 'old')).toBe(0);
    expect(amountFor(bill, 'mine', null)).toBe(0);
  });

  it('totals months, skipping bills I am not in', () => {
    const list = [
      bill,
      expense('2026-10-05', 5000, { split: { rahul: 5000 }, paidBy: { rahul: 5000 } }),
      expense('2026-09-05', 2000),
    ];
    expect(monthlyTotals(list, ['2026-09', '2026-10'], 'mine', 'me')).toEqual([
      { month: '2026-09', total: 2000, count: 1 },
      { month: '2026-10', total: 30000, count: 1 },
    ]);
    expect(monthlyTotals(list, ['2026-10'], 'group', 'me')).toEqual([
      { month: '2026-10', total: 95000, count: 2 },
    ]);
  });
});

describe('percentages', () => {
  it('always adds up to 100', () => {
    expect(percentages([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentages([2, 1])).toEqual([67, 33]);
    expect(percentages([999, 1])).toEqual([100, 0]);
    for (const values of [
      [7, 13, 29, 51, 3],
      [1, 1, 1, 1, 1, 1, 1],
      [123456, 654321, 1],
    ]) {
      expect(percentages(values).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('is zero for nothing', () => {
    expect(percentages([0, 0])).toEqual([0, 0]);
    expect(percentages([])).toEqual([]);
  });
});

describe('categoryTotals', () => {
  it('groups custom names case-insensitively and sorts largest first', () => {
    const list = [
      expense('2026-10-01', 1000, { category: 'other', categoryLabel: 'Petrol' }),
      expense('2026-10-02', 3000, { category: 'other', categoryLabel: 'petrol' }),
      expense('2026-10-03', 500, { category: 'other', categoryLabel: null }),
      expense('2026-10-04', 2000, { category: 'stay' }),
      expense('2026-09-04', 99999, { category: 'stay' }),
    ];
    const result = categoryTotals(list, '2026-10', 'group', 'me');
    expect(result.map((c) => [c.name, c.total, c.count, c.percent])).toEqual([
      ['Petrol', 4000, 2, 61],
      ['Stay', 2000, 1, 31],
      ['Other', 500, 1, 8],
    ]);
    expect(result[0]!.key).toBe('other:petrol');
  });

  it('reads an unknown category as Other', () => {
    const [only] = categoryTotals(
      [expense('2026-10-01', 100, { category: 'pets' })],
      null,
      'group',
      null,
    );
    expect(only!.name).toBe('Other');
  });
});

describe('memberTotals', () => {
  it('adds paid and share per member, including people who left', () => {
    const list = [
      expense('2026-10-01', 90000, {
        split: { me: 30000, rahul: 30000, old: 30000 },
        paidBy: { rahul: 90000 },
      }),
      expense('2026-10-02', 10000, { split: { me: 10000 }, paidBy: { me: 10000 } }),
      expense('2026-11-02', 777, { split: { me: 777 }, paidBy: { me: 777 } }),
    ];
    expect(memberTotals(list, members, '2026-10')).toEqual([
      { memberId: 'me', name: 'Asha', active: true, paid: 10000, share: 40000, percent: 40 },
      { memberId: 'rahul', name: 'Rahul', active: true, paid: 90000, share: 30000, percent: 30 },
      { memberId: 'old', name: 'Vikram', active: false, paid: 0, share: 30000, percent: 30 },
    ]);
  });

  it('names a member this phone does not know', () => {
    const [row] = memberTotals(
      [expense('2026-10-01', 100, { split: { ghost: 100 }, paidBy: { ghost: 100 } })],
      members,
      null,
    );
    expect(row!.name).toBe('Unknown member');
  });
});

describe('summarize', () => {
  const list = [
    expense('2026-08-20', 4000, { description: 'Groceries' }),
    expense('2026-09-01', 1000),
    expense('2026-10-01', 2500, { description: 'Dinner' }),
    expense('2026-10-09', 500),
  ];
  const months = monthlyTotals(list, ['2026-08', '2026-09', '2026-10'], 'group', null);

  it('gives all-time totals with a monthly average', () => {
    const s = summarize(list, months, null, 'group', null);
    expect(s).toMatchObject({ total: 8000, count: 4, monthlyAverage: 2667, previousTotal: null });
    expect(s.largest).toMatchObject({ description: 'Groceries', amount: 4000 });
  });

  it('compares a month with the one before', () => {
    const s = summarize(list, months, '2026-10', 'group', null);
    expect(s).toMatchObject({ total: 3000, count: 2, monthlyAverage: null, previousTotal: 1000 });
    expect(s.largest?.description).toBe('Dinner');
  });

  it('handles an empty month', () => {
    const s = summarize(list, months, '2026-07', 'group', null);
    expect(s).toMatchObject({ total: 0, count: 0, largest: null, previousTotal: 0 });
  });
});

describe('computeInsights', () => {
  it('leaves out the per-person view for my share', () => {
    const list = [expense('2026-10-01', 100)];
    const opts = { me: 'me', period: null, today: '2026-10-11' };
    expect(computeInsights(list, members, { ...opts, scope: 'group' }).members).toHaveLength(1);
    expect(computeInsights(list, members, { ...opts, scope: 'mine' }).members).toEqual([]);
  });
});
