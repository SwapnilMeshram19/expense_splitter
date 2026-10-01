import { mulberry32, randInt } from '../../test-utils/prng';
import {
  computeBalances,
  computePairwiseDebts,
  type LedgerExpense,
  type LedgerSettlement,
} from '../balances';
import { allocateByWeights, computeSplit } from '../splits';

const asObject = (map: Map<string, number>) => Object.fromEntries([...map].sort());

// A paid ₹9 for A, B, C equally.
const dinner: LedgerExpense = {
  id: 'e1',
  payers: [{ memberId: 'a', amountPaise: 900 }],
  shares: [
    { memberId: 'a', amountPaise: 300 },
    { memberId: 'b', amountPaise: 300 },
    { memberId: 'c', amountPaise: 300 },
  ],
};

// A paid ₹6, B paid ₹3; shared equally by A, B, C.
const multiPayer: LedgerExpense = {
  id: 'e2',
  payers: [
    { memberId: 'a', amountPaise: 600 },
    { memberId: 'b', amountPaise: 300 },
  ],
  shares: [
    { memberId: 'a', amountPaise: 300 },
    { memberId: 'b', amountPaise: 300 },
    { memberId: 'c', amountPaise: 300 },
  ],
};

describe('computeBalances', () => {
  it('computes paid − owed for a single payer', () => {
    const { balances, invalidIds } = computeBalances([dinner], []);
    expect(asObject(balances)).toEqual({ a: 600, b: -300, c: -300 });
    expect(invalidIds).toEqual([]);
  });

  it('handles multiple payers', () => {
    expect(asObject(computeBalances([multiPayer], []).balances)).toEqual({ a: 300, b: 0, c: -300 });
  });

  it('applies settlements (payer up, receiver down)', () => {
    const settlement: LedgerSettlement = {
      id: 's1',
      fromMemberId: 'b',
      toMemberId: 'a',
      amountPaise: 300,
    };
    expect(asObject(computeBalances([dinner], [settlement]).balances)).toEqual({
      a: 300,
      b: 0,
      c: -300,
    });
  });

  it('returns empty balances for an empty group', () => {
    const { balances, invalidIds } = computeBalances([], []);
    expect(balances.size).toBe(0);
    expect(invalidIds).toEqual([]);
  });
});

describe('integrity checks', () => {
  const line = (memberId: string, amountPaise: number) => ({ memberId, amountPaise });

  it.each<[string, LedgerExpense]>([
    ['no payers', { id: 'x', payers: [], shares: [line('a', 100)] }],
    ['no shares', { id: 'x', payers: [line('a', 100)], shares: [] }],
    ['payer sum ≠ share sum', { id: 'x', payers: [line('a', 100)], shares: [line('a', 99)] }],
    ['zero total', { id: 'x', payers: [line('a', 0)], shares: [line('a', 0)] }],
    ['negative amount', { id: 'x', payers: [line('a', 100)], shares: [line('a', 200), line('b', -100)] }],
    ['fractional amount', { id: 'x', payers: [line('a', 100)], shares: [line('a', 99.5), line('b', 0.5)] }],
    ['blank member id', { id: 'x', payers: [line('', 100)], shares: [line('a', 100)] }],
    ['duplicate member', { id: 'x', payers: [line('a', 100)], shares: [line('b', 50), line('b', 50)] }],
  ])('skips and reports expense with %s', (_label, expense) => {
    const { balances, invalidIds } = computeBalances([dinner, expense], []);
    expect(invalidIds).toEqual(['x']);
    expect(asObject(balances)).toEqual({ a: 600, b: -300, c: -300 }); // unaffected
    expect(computePairwiseDebts([expense], []).invalidIds).toEqual(['x']);
  });

  it.each<[string, Partial<LedgerSettlement>]>([
    ['blank from', { fromMemberId: '' }],
    ['blank to', { toMemberId: '' }],
    ['self payment', { toMemberId: 'b' }],
    ['zero amount', { amountPaise: 0 }],
    ['fractional amount', { amountPaise: 10.5 }],
  ])('skips and reports settlement with %s', (_label, override) => {
    const settlement: LedgerSettlement = {
      id: 's',
      fromMemberId: 'b',
      toMemberId: 'a',
      amountPaise: 100,
      ...override,
    };
    const { balances, invalidIds } = computeBalances([dinner], [settlement]);
    expect(invalidIds).toEqual(['s']);
    expect(asObject(balances)).toEqual({ a: 600, b: -300, c: -300 });
  });
});

describe('computePairwiseDebts', () => {
    it('keeps payer totals exact at paisa scale without creating cycles', () => {
    // A, B, C each paid 1 paisa and each owes 1 paisa: nobody owes anybody.
    const tiny: LedgerExpense = {
      id: 'tiny',
      payers: [
        { memberId: 'a', amountPaise: 1 },
        { memberId: 'b', amountPaise: 1 },
        { memberId: 'c', amountPaise: 1 },
      ],
      shares: [
        { memberId: 'a', amountPaise: 1 },
        { memberId: 'b', amountPaise: 1 },
        { memberId: 'c', amountPaise: 1 },
      ],
    };
    expect(computePairwiseDebts([tiny], []).debts).toEqual([]);
    expect(asObject(computeBalances([tiny], []).balances)).toEqual({ a: 0, b: 0, c: 0 });
  });
  it('creates debts from each sharer to the payer', () => {
    expect(computePairwiseDebts([dinner], []).debts).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', amountPaise: 300 },
      { fromMemberId: 'c', toMemberId: 'a', amountPaise: 300 },
    ]);
  });

  it('splits each share across multiple payers and nets opposite directions', () => {
    // C owes A 200 + B 100. B owes A 200 for its share, A owes B 100 for its share → net B→A 100.
    expect(computePairwiseDebts([multiPayer], []).debts).toEqual([
      { fromMemberId: 'b', toMemberId: 'a', amountPaise: 100 },
      { fromMemberId: 'c', toMemberId: 'a', amountPaise: 200 },
      { fromMemberId: 'c', toMemberId: 'b', amountPaise: 100 },
    ]);
  });

  it('removes a pair once fully settled and flips direction on overpayment', () => {
    const settle = (amountPaise: number): LedgerSettlement => ({
      id: 's',
      fromMemberId: 'b',
      toMemberId: 'a',
      amountPaise,
    });
    expect(computePairwiseDebts([dinner], [settle(300)]).debts).toEqual([
      { fromMemberId: 'c', toMemberId: 'a', amountPaise: 300 },
    ]);
    expect(computePairwiseDebts([dinner], [settle(500)]).debts).toEqual([
      { fromMemberId: 'a', toMemberId: 'b', amountPaise: 200 },
      { fromMemberId: 'c', toMemberId: 'a', amountPaise: 300 },
    ]);
  });
});

describe('invariants (property test)', () => {
  it('balances sum to zero and pairwise debts reconstruct balances exactly', () => {
    const rand = mulberry32(7);
    const members = ['a', 'b', 'c', 'd', 'e'];

    for (let run = 0; run < 300; run++) {
      const expenses: LedgerExpense[] = [];
      for (let i = 0; i < randInt(rand, 1, 8); i++) {
        const total = randInt(rand, 1, 100_000);

        const participants = members.filter(() => rand() < 0.6);
        if (participants.length === 0) participants.push('a');
        const split = computeSplit(total, { type: 'equal', memberIds: participants });
        if (!split.ok) throw new Error('unexpected split failure');

        const payerIds = members.filter(() => rand() < 0.3);
        if (payerIds.length === 0) payerIds.push('b');
        const payers = allocateByWeights(
          total,
          payerIds.map((memberId) => ({ memberId, value: randInt(rand, 1, 5) })),
        );

        expenses.push({ id: `e${i}`, payers, shares: split.shares });
      }

      const settlements: LedgerSettlement[] = [];
      for (let i = 0; i < randInt(rand, 0, 2); i++) {
        const from = randInt(rand, 0, 4);
        const to = (from + randInt(rand, 1, 4)) % 5;
        settlements.push({
          id: `s${i}`,
          fromMemberId: members[from] ?? 'a',
          toMemberId: members[to] ?? 'b',
          amountPaise: randInt(rand, 1, 50_000),
        });
      }

      const { balances, invalidIds } = computeBalances(expenses, settlements);
      expect(invalidIds).toEqual([]);
      expect([...balances.values()].reduce((s, v) => s + v, 0)).toBe(0);

      const rebuilt = new Map<string, number>();
      for (const d of computePairwiseDebts(expenses, settlements).debts) {
        expect(d.amountPaise).toBeGreaterThan(0);
        rebuilt.set(d.fromMemberId, (rebuilt.get(d.fromMemberId) ?? 0) - d.amountPaise);
        rebuilt.set(d.toMemberId, (rebuilt.get(d.toMemberId) ?? 0) + d.amountPaise);
      }
      for (const [memberId, balance] of balances) {
        expect(rebuilt.get(memberId) ?? 0).toBe(balance);
      }
    }
  });
});