import { mulberry32, randInt } from '../../test-utils/prng';
import { simplifyDebts } from '../simplify';

const balancesOf = (entries: Array<[string, number]>) => new Map(entries);

describe('simplifyDebts', () => {
  it('returns no transfers for an empty or settled group', () => {
    expect(simplifyDebts(new Map())).toEqual([]);
    expect(simplifyDebts(balancesOf([['a', 0], ['b', 0]]))).toEqual([]);
  });

  it('collapses a chain A→B→C into A→C', () => {
    // A owes B 100, B owes C 100 → net: A −100, B 0, C +100
    expect(simplifyDebts(balancesOf([['a', -100], ['b', 0], ['c', 100]]))).toEqual([
      { fromMemberId: 'a', toMemberId: 'c', amountPaise: 100 },
    ]);
  });

  it('matches largest debtor with largest creditor', () => {
    expect(
      simplifyDebts(balancesOf([['a', 700], ['b', 300], ['c', -500], ['d', -500]])),
    ).toEqual([
      { fromMemberId: 'c', toMemberId: 'a', amountPaise: 500 },
      { fromMemberId: 'd', toMemberId: 'b', amountPaise: 300 },
      { fromMemberId: 'd', toMemberId: 'a', amountPaise: 200 },
    ]);
  });

  it('breaks ties by member id and ignores input order', () => {
    const expected = [
      { fromMemberId: 'a', toMemberId: 'c', amountPaise: 100 },
      { fromMemberId: 'b', toMemberId: 'c', amountPaise: 100 },
    ];
    expect(simplifyDebts(balancesOf([['a', -100], ['b', -100], ['c', 200]]))).toEqual(expected);
    expect(simplifyDebts(balancesOf([['c', 200], ['b', -100], ['a', -100]]))).toEqual(expected);
  });

  it('throws on non-zero sum or non-integer balances (programmer error)', () => {
    expect(() => simplifyDebts(balancesOf([['a', 100], ['b', -99]]))).toThrow(RangeError);
    expect(() => simplifyDebts(balancesOf([['a', 0.5], ['b', -0.5]]))).toThrow(RangeError);
  });

  it('always settles everyone with at most n−1 positive transfers (property test)', () => {
    const rand = mulberry32(99);

    for (let run = 0; run < 1000; run++) {
      const n = randInt(rand, 2, 12);
      const balances = new Map<string, number>();
      let sum = 0;
      for (let i = 0; i < n - 1; i++) {
        const value = randInt(rand, -10_000, 10_000);
        balances.set(`m${i}`, value);
        sum += value;
      }
      balances.set(`m${n - 1}`, -sum);

      const transfers = simplifyDebts(balances);

      const nonZero = [...balances.values()].filter((v) => v !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));

      const remaining = new Map(balances);
      for (const t of transfers) {
        expect(t.amountPaise).toBeGreaterThan(0);
        expect(t.fromMemberId).not.toBe(t.toMemberId);
        remaining.set(t.fromMemberId, (remaining.get(t.fromMemberId) ?? 0) + t.amountPaise);
        remaining.set(t.toMemberId, (remaining.get(t.toMemberId) ?? 0) - t.amountPaise);
      }
      for (const value of remaining.values()) expect(value).toBe(0);
    }
  });
});