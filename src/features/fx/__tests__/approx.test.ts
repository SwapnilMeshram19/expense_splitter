import { setIndianGroupingForInr } from '@/domain/currency';

import { approxInHome } from '../approx';
import type { RateTable } from '../rateCache';

const table: RateTable = {
  fetchedAt: 0,
  rates: {
    USD: { perUsd: '1', asOf: '2026-10-10', source: 'frankfurter' },
    INR: { perUsd: '86.5', asOf: '2026-10-10', source: 'frankfurter' },
    JPY: { perUsd: '150', asOf: '2026-10-10', source: 'frankfurter' },
  },
};

afterEach(() => setIndianGroupingForInr(true));

describe('approxInHome', () => {
  it('shows an amount roughly in the home currency, rounded to whole units', () => {
    expect(approxInHome(4500, 'USD', 'INR', table)).toBe('≈ ₹3,893'); // $45 × 86.5 = ₹3,892.50
    expect(approxInHome(-4500, 'USD', 'INR', table)).toBe('≈ ₹3,893');
    expect(approxInHome(389250, 'INR', 'USD', table)).toBe('≈ $45');
    expect(approxInHome(150000, 'JPY', 'USD', table)).toBe('≈ $1,000');
  });

  it('keeps decimals for amounts under one unit', () => {
    expect(approxInHome(4000, 'INR', 'USD', table)).toBe('≈ $0.46'); // ₹40
    expect(approxInHome(40, 'INR', 'USD', table)).toBeNull(); // ₹0.40 is under a cent
  });

  it('follows the rupee grouping setting', () => {
    expect(approxInHome(200000, 'USD', 'INR', table)).toBe('≈ ₹1,73,000');
    setIndianGroupingForInr(false);
    expect(approxInHome(200000, 'USD', 'INR', table)).toBe('≈ ₹173,000');
  });

  it('shows nothing for the same currency, zero, or a missing rate', () => {
    expect(approxInHome(4500, 'INR', 'INR', table)).toBeNull();
    expect(approxInHome(0, 'USD', 'INR', table)).toBeNull();
    expect(approxInHome(4500, 'EUR', 'INR', table)).toBeNull();
    expect(approxInHome(4500, 'USD', 'INR', null)).toBeNull();
  });
});
