import { MAX_AMOUNT_PAISE } from '../money';
import {
  MAX_SHARE_UNITS,
  allocateByWeights,
  compareMemberIds,
  computeSplit,
  itemsSubtotal,
  parsePercentToBasisPoints,
  type SplitInput,
  type SplitResult,
} from '../splits';

function amounts(result: SplitResult): Record<string, number> {
  if (!result.ok) throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`);
  return Object.fromEntries(result.shares.map((s) => [s.memberId, s.amountPaise]));
}

function errorOf(result: SplitResult) {
  if (result.ok) throw new Error('Expected error, got ok');
  return result.error;
}

/** Small deterministic PRNG so property tests are reproducible without extra deps. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('compareMemberIds', () => {
  it('orders by UTF-16 code units, independent of locale', () => {
    expect(compareMemberIds('a', 'b')).toBe(-1);
    expect(compareMemberIds('b', 'a')).toBe(1);
    expect(compareMemberIds('a', 'a')).toBe(0);
    expect(compareMemberIds('B', 'a')).toBe(-1); // uppercase before lowercase, unlike localeCompare
  });
});

describe('total validation', () => {
  it.each([0, -100, 1.5, Number.NaN, MAX_AMOUNT_PAISE + 1])('rejects total %p', (total) => {
    expect(errorOf(computeSplit(total, { type: 'equal', memberIds: ['a'] }))).toEqual({
      code: 'INVALID_TOTAL',
    });
  });

  it('rejects an unknown split type instead of throwing (tampered JSON)', () => {
    const bogus = { type: 'bogus' } as unknown as SplitInput;
    expect(errorOf(computeSplit(100, bogus))).toEqual({ code: 'INVALID_SPLIT_TYPE' });
  });
});

describe('equal split', () => {
  it('gives the extra paisa to the lowest member id', () => {
    expect(amounts(computeSplit(10000, { type: 'equal', memberIds: ['a', 'b', 'c'] }))).toEqual({
      a: 3334,
      b: 3333,
      c: 3333,
    });
  });

  it('does not depend on input order', () => {
    expect(amounts(computeSplit(10000, { type: 'equal', memberIds: ['c', 'a', 'b'] }))).toEqual({
      a: 3334,
      b: 3333,
      c: 3333,
    });
  });

  it('handles a total smaller than the member count', () => {
    expect(amounts(computeSplit(2, { type: 'equal', memberIds: ['a', 'b', 'c'] }))).toEqual({
      a: 1,
      b: 1,
      c: 0,
    });
  });

  it('rejects empty, blank and duplicate members', () => {
    expect(errorOf(computeSplit(100, { type: 'equal', memberIds: [] }))).toEqual({
      code: 'NO_PARTICIPANTS',
    });
    expect(errorOf(computeSplit(100, { type: 'equal', memberIds: [''] }))).toEqual({
      code: 'INVALID_VALUE',
    });
    expect(errorOf(computeSplit(100, { type: 'equal', memberIds: ['a', 'a'] }))).toEqual({
      code: 'DUPLICATE_MEMBER',
      memberId: 'a',
    });
  });
});

describe('exact split', () => {
  it('accepts amounts that sum to the total and drops zero lines', () => {
    const result = computeSplit(10000, {
      type: 'exact',
      entries: [
        { memberId: 'a', value: 6000 },
        { memberId: 'b', value: 4000 },
        { memberId: 'c', value: 0 },
      ],
    });
    expect(amounts(result)).toEqual({ a: 6000, b: 4000 });
  });

  it('reports the mismatch so the UI can show the remaining amount', () => {
    const result = computeSplit(10000, {
      type: 'exact',
      entries: [
        { memberId: 'a', value: 6000 },
        { memberId: 'b', value: 3000 },
      ],
    });
    expect(errorOf(result)).toEqual({ code: 'EXACT_SUM_MISMATCH', expected: 10000, actual: 9000 });
  });

  it('rejects negative and fractional values', () => {
    expect(
      errorOf(computeSplit(100, { type: 'exact', entries: [{ memberId: 'a', value: -100 }] })),
    ).toEqual({ code: 'INVALID_VALUE', memberId: 'a' });
    expect(
      errorOf(computeSplit(100, { type: 'exact', entries: [{ memberId: 'a', value: 99.5 }] })),
    ).toEqual({ code: 'INVALID_VALUE', memberId: 'a' });
  });
});

describe('percentage split', () => {
  it('splits by basis points', () => {
    const result = computeSplit(10000, {
      type: 'percentage',
      entries: [
        { memberId: 'a', value: 3333 },
        { memberId: 'b', value: 3333 },
        { memberId: 'c', value: 3334 },
      ],
    });
    expect(amounts(result)).toEqual({ a: 3333, b: 3333, c: 3334 });
  });

  it('rounds with largest remainder', () => {
    const result = computeSplit(99999, {
      type: 'percentage',
      entries: [
        { memberId: 'a', value: 5000 },
        { memberId: 'b', value: 5000 },
      ],
    });
    expect(amounts(result)).toEqual({ a: 50000, b: 49999 });
  });

  it('drops members at 0%', () => {
    const result = computeSplit(500, {
      type: 'percentage',
      entries: [
        { memberId: 'a', value: 10000 },
        { memberId: 'b', value: 0 },
      ],
    });
    expect(amounts(result)).toEqual({ a: 500 });
  });

  it('rejects percentages not summing to 100%', () => {
    const result = computeSplit(10000, {
      type: 'percentage',
      entries: [
        { memberId: 'a', value: 3333 },
        { memberId: 'b', value: 3333 },
        { memberId: 'c', value: 3333 },
      ],
    });
    expect(errorOf(result)).toEqual({
      code: 'PERCENT_SUM_MISMATCH',
      expected: 10000,
      actual: 9999,
    });
  });

  it('rejects a single value above 100%', () => {
    expect(
      errorOf(
        computeSplit(100, { type: 'percentage', entries: [{ memberId: 'a', value: 10001 }] }),
      ),
    ).toEqual({ code: 'INVALID_VALUE', memberId: 'a' });
  });
});

describe('shares split', () => {
  it('splits 2:1:1', () => {
    const result = computeSplit(1000, {
      type: 'shares',
      entries: [
        { memberId: 'a', value: 2 },
        { memberId: 'b', value: 1 },
        { memberId: 'c', value: 1 },
      ],
    });
    expect(amounts(result)).toEqual({ a: 500, b: 250, c: 250 });
  });

  it('rounds 1:1:1 of 100 paise', () => {
    const result = computeSplit(100, {
      type: 'shares',
      entries: [
        { memberId: 'c', value: 1 },
        { memberId: 'b', value: 1 },
        { memberId: 'a', value: 1 },
      ],
    });
    expect(amounts(result)).toEqual({ a: 34, b: 33, c: 33 });
  });

  it('rejects all-zero shares and values above the cap', () => {
    expect(
      errorOf(
        computeSplit(100, {
          type: 'shares',
          entries: [
            { memberId: 'a', value: 0 },
            { memberId: 'b', value: 0 },
          ],
        }),
      ),
    ).toEqual({ code: 'NO_PARTICIPANTS' });
    expect(
      errorOf(
        computeSplit(100, {
          type: 'shares',
          entries: [{ memberId: 'a', value: MAX_SHARE_UNITS + 1 }],
        }),
      ),
    ).toEqual({ code: 'INVALID_VALUE', memberId: 'a' });
  });
});

describe('itemized split', () => {
  const items = [
    { amountPaise: 300, memberIds: ['a'] },
    { amountPaise: 600, memberIds: ['a', 'b'] },
  ];

  it('matches item subtotals when total equals item sum', () => {
    expect(itemsSubtotal(items)).toBe(900);
    expect(amounts(computeSplit(900, { type: 'itemized', items }))).toEqual({ a: 600, b: 300 });
  });

  it('spreads tax / service charge proportionally', () => {
    expect(amounts(computeSplit(990, { type: 'itemized', items }))).toEqual({ a: 660, b: 330 });
  });

  it('spreads a discount proportionally', () => {
    expect(amounts(computeSplit(810, { type: 'itemized', items }))).toEqual({ a: 540, b: 270 });
  });

  it('rounds within a shared item', () => {
    const result = computeSplit(100, {
      type: 'itemized',
      items: [{ amountPaise: 100, memberIds: ['a', 'b', 'c'] }],
    });
    expect(amounts(result)).toEqual({ a: 34, b: 33, c: 33 });
  });

  it('rejects an empty item list', () => {
    expect(errorOf(computeSplit(100, { type: 'itemized', items: [] }))).toEqual({
      code: 'NO_PARTICIPANTS',
    });
  });

  it('rejects unassigned and invalid items with the right index', () => {
    const valid = { amountPaise: 100, memberIds: ['a'] };
    const cases: Array<[SplitInput, object]> = [
      [
        { type: 'itemized', items: [{ amountPaise: 100, memberIds: [] }] },
        { code: 'ITEM_UNASSIGNED', itemIndex: 0 },
      ],
      [
        { type: 'itemized', items: [{ amountPaise: 0, memberIds: ['a'] }] },
        { code: 'ITEM_INVALID', itemIndex: 0 },
      ],
      [
        { type: 'itemized', items: [valid, { amountPaise: MAX_AMOUNT_PAISE + 1, memberIds: ['a'] }] },
        { code: 'ITEM_INVALID', itemIndex: 1 },
      ],
      [
        { type: 'itemized', items: [valid, { amountPaise: 100, memberIds: ['a', 'a'] }] },
        { code: 'ITEM_INVALID', itemIndex: 1 },
      ],
      [
        { type: 'itemized', items: [{ amountPaise: 100, memberIds: [''] }] },
        { code: 'ITEM_INVALID', itemIndex: 0 },
      ],
    ];
    for (const [input, expected] of cases) {
      expect(errorOf(computeSplit(1000, input))).toEqual(expected);
    }
  });
});

describe('allocateByWeights', () => {
  it('throws on programmer errors', () => {
    const one = [{ memberId: 'a', value: 1 }];
    expect(() => allocateByWeights(-1, one)).toThrow(RangeError);
    expect(() => allocateByWeights(1.5, one)).toThrow(RangeError);
    expect(() => allocateByWeights(100, [{ memberId: 'a', value: -1 }])).toThrow(RangeError);
    expect(() => allocateByWeights(100, [{ memberId: 'a', value: 0.5 }])).toThrow(RangeError);
    expect(() => allocateByWeights(100, [{ memberId: 'a', value: 0 }])).toThrow(RangeError);
    expect(() => allocateByWeights(100, [])).toThrow(RangeError);
  });

  it('always sums to the total and keeps each share within 1 paisa of exact', () => {
    const rand = mulberry32(42);
    for (let run = 0; run < 2000; run++) {
      const total = 1 + Math.floor(rand() * 10_000_000);
      const n = 1 + Math.floor(rand() * 12);
      const weights = Array.from({ length: n }, (_, i) => ({
        memberId: `m${i}`,
        value: 1 + Math.floor(rand() * 1000),
      }));
      const weightSum = weights.reduce((s, w) => s + w.value, 0);

      const lines = allocateByWeights(total, weights);

      expect(lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(total);
      lines.forEach((line, i) => {
        const exact = (total * (weights[i]?.value ?? 0)) / weightSum;
        expect(Math.abs(line.amountPaise - exact)).toBeLessThan(1);
      });
    }
  });

  it('does not overflow with max totals and paise-sized weights', () => {
    const lines = allocateByWeights(MAX_AMOUNT_PAISE, [
      { memberId: 'a', value: MAX_AMOUNT_PAISE },
      { memberId: 'b', value: MAX_AMOUNT_PAISE - 1 },
      { memberId: 'c', value: 7 },
    ]);
    expect(lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(MAX_AMOUNT_PAISE);
  });
});

describe('parsePercentToBasisPoints', () => {
  it.each([
    ['33.33', 3333],
    ['12.5', 1250],
    ['50%', 5000],
    ['100', 10000],
    ['0', 0],
  ])('%s -> %s', (input, expected) => {
    expect(parsePercentToBasisPoints(input)).toBe(expected);
  });

  it.each(['100.01', '12.345', 'abc', '', '-5'])('rejects %p', (input) => {
    expect(parsePercentToBasisPoints(input)).toBeNull();
  });
});