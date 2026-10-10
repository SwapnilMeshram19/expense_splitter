import { createTestContext, type TestContext } from '@/db/__tests__/testDb';

import {
  FX_REFRESH_AFTER_MS,
  getCachedRates,
  parseRatePayload,
  ratesAreStale,
  saveRates,
  suggestRate,
} from '../rateCache';

const payload = {
  rates: {
    USD: ['1', '2026-10-10', 'frankfurter'],
    INR: ['96.64', '2026-10-10', 'frankfurter'],
    AED: ['3.6725', '2026-10-09', 'frankfurter'],
    MVR: ['15.42', '2026-10-10', 'exchangerate-api'],
    // Dropped: unknown code, bad rate, bad date, unknown source, not an array.
    XYZ: ['1', '2026-10-10', 'frankfurter'],
    JPY: ['-1', '2026-10-10', 'frankfurter'],
    EUR: ['0.92', '10/10/2026', 'frankfurter'],
    GBP: ['0.79', '2026-10-10', 'somewhere'],
    THB: '33.1',
  },
};

describe('parseRatePayload', () => {
  it('keeps only well-formed rows', () => {
    const table = parseRatePayload(payload, 1000)!;
    expect(Object.keys(table.rates).sort()).toEqual(['AED', 'INR', 'MVR', 'USD']);
    expect(table.fetchedAt).toBe(1000);
  });

  it('adds USD when the feed leaves it out, and refuses empty or malformed payloads', () => {
    const table = parseRatePayload({ rates: { INR: ['96.64', '2026-10-10', 'frankfurter'] } }, 1)!;
    expect(table.rates.USD).toEqual({ perUsd: '1', asOf: '2026-10-10', source: 'frankfurter' });
    expect(parseRatePayload({ rates: {} }, 1)).toBeNull();
    expect(parseRatePayload(null, 1)).toBeNull();
    expect(parseRatePayload({ rates: 'x' }, 1)).toBeNull();
  });
});

describe('suggestRate', () => {
  const table = parseRatePayload(payload, 0)!;

  it('derives the cross rate with the older date and every source involved', () => {
    expect(suggestRate(table, 'USD', 'INR')).toEqual({
      rate: '96.64',
      asOf: '2026-10-10',
      sources: ['frankfurter'],
    });
    expect(suggestRate(table, 'AED', 'INR')).toEqual({
      rate: '26.3144996596',
      asOf: '2026-10-09',
      sources: ['frankfurter'],
    });
    expect(suggestRate(table, 'MVR', 'INR')?.sources).toEqual(['exchangerate-api', 'frankfurter']);
  });

  it('returns null for unknown pairs, same currency or no table', () => {
    expect(suggestRate(table, 'THB', 'INR')).toBeNull();
    expect(suggestRate(table, 'INR', 'INR')).toBeNull();
    expect(suggestRate(null, 'USD', 'INR')).toBeNull();
  });
});

describe('cache', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });
  afterEach(() => t.close());

  it('saves, reads back and knows when it is stale', () => {
    expect(getCachedRates(t.ctx)).toBeNull();
    const table = parseRatePayload(payload, 5000)!;
    saveRates(t.ctx, table);
    saveRates(t.ctx, table); // upsert
    expect(getCachedRates(t.ctx)).toEqual(table);

    expect(ratesAreStale(null, 0)).toBe(true);
    expect(ratesAreStale(table, 5000 + FX_REFRESH_AFTER_MS)).toBe(false);
    expect(ratesAreStale(table, 5001 + FX_REFRESH_AFTER_MS)).toBe(true);
    // Clock moved backwards: refresh rather than trust it.
    expect(ratesAreStale(table, 4000)).toBe(true);
  });
});
