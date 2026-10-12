import { usesIndianGroupingForInr } from '../currency';
import { clean, composePush, parsePushEntries, PUSH_BODY_MAX, type PushEntry } from '../pushText';

const G = '99000000-0000-0000-0000-000000000001';
const E1 = 'e9000000-0000-0000-0000-000000000001';
const E2 = 'e9000000-0000-0000-0000-000000000002';
const E3 = 'e9000000-0000-0000-0000-000000000003';
const S1 = 'c9000000-0000-0000-0000-000000000001';
const S2 = 'c9000000-0000-0000-0000-000000000002';

const expense = (id: string, description: string, extra: Record<string, unknown> = {}) => ({
  type: 'expense',
  expense_id: id,
  description,
  amount: 900000,
  share: 300000,
  paid: 0,
  actor: 'Asha',
  recurring: false,
  ...extra,
});

const payment = (id: string, extra: Record<string, unknown> = {}) => ({
  type: 'payment',
  settlement_id: id,
  amount: 300000,
  from_name: 'Rahul',
  to_name: 'Asha',
  role: 'to',
  actor: 'Rahul',
  ...extra,
});

const raw = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  token: 'token-1234567890',
  indian_grouping: true,
  kind: 'activity',
  group_id: G.toUpperCase(),
  group_name: 'Goa trip',
  currency: 'INR',
  events,
  ...extra,
});

const one = (events: unknown[], extra: Record<string, unknown> = {}): PushEntry => {
  const [entry] = parsePushEntries([raw(events, extra)]);
  if (!entry) throw new Error('entry did not parse');
  return entry;
};

describe('parsePushEntries', () => {
  it('reads entries and normalises ids', () => {
    const [entry] = parsePushEntries([raw([expense(E1, 'Dinner')])]);
    expect(entry).toMatchObject({
      token: 'token-1234567890',
      groupId: G,
      kind: 'activity',
      indianGrouping: true,
    });
    expect(entry!.events[0]).toEqual({
      type: 'expense',
      expenseId: E1,
      description: 'Dinner',
      amount: 900000,
      share: 300000,
      paid: 0,
      actor: 'Asha',
      recurring: false,
    });
  });

  it('skips malformed entries and events', () => {
    expect(parsePushEntries(null)).toEqual([]);
    expect(parsePushEntries([null, 'x', []])).toEqual([]);
    expect(parsePushEntries([raw([expense(E1, 'Dinner')], { token: '' })])).toEqual([]);
    expect(parsePushEntries([raw([expense(E1, 'Dinner')], { currency: 'XXX' })])).toEqual([]);
    expect(parsePushEntries([raw([expense(E1, 'Dinner')], { group_id: 'nope' })])).toEqual([]);
    expect(parsePushEntries([raw([expense(E1, 'Dinner')], { kind: 'other' })])).toEqual([]);
    expect(parsePushEntries([raw([], {})])).toEqual([]);
    expect(parsePushEntries([raw('not a list' as unknown as unknown[])])).toEqual([]);

    const bad = [
      expense(E1, ''),
      expense(E1, 'X', { amount: -1 }),
      expense(E1, 'X', { share: 1.5 }),
      expense(E1, 'X', { paid: '1' }),
      expense('nope', 'X'),
      payment(S1, { amount: null }),
      payment(S1, { from_name: '' }),
      payment(S1, { role: 'both' }),
      payment('nope'),
      { type: 'budget', level: 3, limit: 100, spent: 90, period: 'total' },
      { type: 'budget', level: 1, limit: 0, spent: 90, period: 'total' },
      { type: 'budget', level: 1, limit: 100, spent: 90, period: '' },
      { type: 'budget', level: 1, limit: 100, spent: 90, period: 'weekly' },
      { type: 'unknown' },
      'string',
    ];
    const [entry] = parsePushEntries([raw([...bad, expense(E2, 'Taxi')])]);
    expect(entry!.events).toHaveLength(1);
    expect(entry!.events[0]).toMatchObject({ expenseId: E2 });
  });

  it('defaults to Indian grouping unless told otherwise', () => {
    expect(
      parsePushEntries([raw([expense(E1, 'D')], { indian_grouping: null })])[0]!.indianGrouping,
    ).toBe(true);
    expect(
      parsePushEntries([raw([expense(E1, 'D')], { indian_grouping: false })])[0]!.indianGrouping,
    ).toBe(false);
  });
});

describe('composePush: activity', () => {
  it('describes one expense with my share and opens it', () => {
    expect(composePush(one([expense(E1, 'Dinner')]))).toEqual({
      title: 'Goa trip',
      body: 'Asha added “Dinner”: ₹9,000 · your share ₹3,000',
      data: { type: 'group', groupId: G, expenseId: E1 },
      tag: null,
    });
  });

  it('says what I paid when I have no share, nothing when neither', () => {
    expect(composePush(one([expense(E1, 'Gift', { share: 0, paid: 900000 })])).body).toBe(
      'Asha added “Gift”: ₹9,000 · you paid ₹9,000',
    );
    expect(composePush(one([expense(E1, 'Gift', { share: 0, paid: 0, actor: null })])).body).toBe(
      'Someone added “Gift”: ₹9,000',
    );
  });

  it('describes a repeating expense', () => {
    expect(
      composePush(
        one([
          expense(E1, 'Rent', { recurring: true, actor: null, amount: 3000000, share: 1500000 }),
        ]),
      ).body,
    ).toBe('Repeating expense “Rent” added: ₹30,000 · your share ₹15,000');
  });

  it('batches several expenses, naming one actor when there is one', () => {
    const body = composePush(
      one([expense(E1, 'Taxi'), expense(E2, 'Ferry'), expense(E3, 'Lunch')]),
    ).body;
    expect(body).toBe('Asha added 3 expenses, “Taxi”, “Ferry” and 1 more · your share ₹9,000');
    const mixed = composePush(one([expense(E1, 'Taxi'), expense(E2, 'Ferry', { actor: 'Priya' })]));
    expect(mixed.body).toBe('New: 2 expenses, “Taxi” and “Ferry” · your share ₹6,000');
    expect(mixed.data.expenseId).toBeUndefined();
  });

  it('describes payments from both sides', () => {
    expect(composePush(one([payment(S1)])).body).toBe('Rahul paid you ₹3,000');
    expect(
      composePush(
        one([payment(S1, { role: 'from', from_name: 'Rahul', to_name: 'Asha', actor: 'Asha' })]),
      ).body,
    ).toBe('Asha confirmed your ₹3,000 payment');
    expect(composePush(one([payment(S1, { role: 'from', actor: 'Priya' })])).body).toBe(
      'Your ₹3,000 payment to Asha was recorded',
    );
    expect(composePush(one([payment(S1, { role: 'from', actor: null })])).body).toBe(
      'Your ₹3,000 payment to Asha was recorded',
    );
  });

  it('sums several payments, and joins expenses and payments', () => {
    expect(composePush(one([payment(S1), payment(S2, { amount: 100000 })])).body).toBe(
      '2 payments: you received ₹4,000',
    );
    expect(
      composePush(one([payment(S1), payment(S2, { role: 'from', amount: 100000 })])).body,
    ).toBe('2 payments: you received ₹3,000, your ₹1,000 in payments recorded');
    const both = composePush(one([expense(E1, 'Dinner'), payment(S1)]));
    expect(both.body).toBe(
      'Asha added “Dinner”: ₹9,000 · your share ₹3,000 · Rahul paid you ₹3,000',
    );
    expect(both.data.expenseId).toBeUndefined();
  });

  it('formats like the recipient’s phone and leaves the global setting alone', () => {
    const before = usesIndianGroupingForInr();
    expect(
      composePush(
        one([expense(E1, 'Hotel', { amount: 12345600, share: 0, paid: 0 })], {
          indian_grouping: false,
        }),
      ).body,
    ).toBe('Asha added “Hotel”: ₹123,456');
    expect(usesIndianGroupingForInr()).toBe(before);
    expect(
      composePush(
        one([expense(E1, 'Hotel', { amount: 1250, share: 0, paid: 0 })], { currency: 'USD' }),
      ).body,
    ).toBe('Asha added “Hotel”: $12.50');
  });

  it('keeps titles and bodies short and on one line', () => {
    const long = composePush(
      one([expense(E1, 'x'.repeat(300))], { group_name: `Goa\ntrip ${'y'.repeat(100)}` }),
    );
    expect(long.title.length).toBeLessThanOrEqual(60);
    expect(long.title).not.toContain('\n');
    expect(long.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(long.body).toContain('…');
  });
});

describe('composePush: budget', () => {
  const budget = (level: number, spent: number, period = 'total') => ({
    type: 'budget',
    level,
    limit: 1000000,
    spent,
    period,
  });

  it('warns at 80% and when over, replacing the previous alert', () => {
    const near = composePush(one([budget(1, 850000)], { kind: 'budget' }));
    expect(near).toEqual({
      title: 'Goa trip',
      body: '85% of the ₹10,000 budget used (₹8,500 spent)',
      data: { type: 'group', groupId: G },
      tag: `budget-${G}`,
    });
    expect(composePush(one([budget(1, 850000), budget(2, 1200000)], { kind: 'budget' })).body).toBe(
      'Over budget: ₹12,000 spent, ₹2,000 more than the ₹10,000 budget',
    );
  });

  it('names the month for monthly budgets', () => {
    expect(composePush(one([budget(1, 900000, '2026-10')], { kind: 'budget' })).body).toBe(
      '90% of the ₹10,000 budget used for October 2026 (₹9,000 spent)',
    );
    expect(composePush(one([budget(2, 1100000, '2026-10')], { kind: 'budget' })).body).toBe(
      'Over budget for October 2026: ₹11,000 spent, ₹1,000 more than the ₹10,000 budget',
    );
  });
});

describe('clean', () => {
  it('collapses whitespace and control characters and cuts by code point', () => {
    expect(clean(' a\n\tb\u0007c ', 10)).toBe('a b c');
    expect(clean('गोवा ट्रिप', 4)).toBe('गोव…');
    expect(clean('abc', 3)).toBe('abc');
  });
});
