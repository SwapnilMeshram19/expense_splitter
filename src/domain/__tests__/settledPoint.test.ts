import { lastSettledIndex, type LedgerStep } from '../settledPoint';

const expense = (payer: string, amount: number, shares: Record<string, number>): LedgerStep => ({
  deltas: [{ memberId: payer, amount }, ...Object.entries(shares).map(([memberId, s]) => ({ memberId, amount: -s }))],
});
const payment = (from: string, to: string, amount: number): LedgerStep => ({
  deltas: [
    { memberId: from, amount },
    { memberId: to, amount: -amount },
  ],
});

describe('lastSettledIndex', () => {
  it('is -1 with nothing settled', () => {
    expect(lastSettledIndex([])).toBe(-1);
    expect(lastSettledIndex([expense('a', 100, { a: 50, b: 50 })])).toBe(-1);
  });

  it('finds the payment that squared everyone', () => {
    const steps = [
      expense('a', 100, { a: 50, b: 50 }),
      payment('b', 'a', 50),
      expense('b', 300, { a: 150, b: 150 }),
    ];
    expect(lastSettledIndex(steps)).toBe(1);
  });

  it('ignores partial payments', () => {
    expect(lastSettledIndex([expense('a', 100, { a: 50, b: 50 }), payment('b', 'a', 30)])).toBe(-1);
  });

  it('moves back when someone still owes after a settle-up', () => {
    const steps = [
      expense('a', 100, { a: 50, b: 50 }),
      payment('b', 'a', 50), // settled here…
      expense('a', 60, { a: 30, c: 30 }),
      expense('c', 60, { a: 30, c: 30 }), // …and here again: a and c are even
    ];
    expect(lastSettledIndex(steps)).toBe(3);
  });

  it('does not call a self-paid expense "settled"', () => {
    expect(lastSettledIndex([expense('a', 100, { a: 100 })])).toBe(-1);
  });

  it('skips unreadable records', () => {
    expect(lastSettledIndex([expense('a', 100, { a: 50, b: 50 }), payment('b', 'a', 50), { deltas: [] }])).toBe(1);
  });
});
