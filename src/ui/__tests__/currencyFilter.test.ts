import { currencyInfo, isSupportedCurrency } from '@/domain/currency';

import { currencyOptions } from '../currencyFilter';

describe('currency picker options', () => {
  it('lists pinned (home) currencies first', () => {
    expect(currencyOptions('', ['USD', 'GBP']).slice(0, 3).map((c) => c.code)).toEqual([
      'USD',
      'GBP',
      'INR',
    ]);
  });

  it('hides retired currencies unless searched for or already chosen', () => {
    expect(currencyInfo('BGN').legacy).toBe(true);
    expect(currencyOptions('').some((c) => c.code === 'BGN')).toBe(false);
    expect(currencyOptions('bgn').map((c) => c.code)).toEqual(['BGN']);
    expect(currencyOptions('', ['BGN'])[0]!.code).toBe('BGN');
  });

  it('includes the GBP-pegged island pounds', () => {
    for (const code of ['FKP', 'GIP', 'SHP']) {
      expect(isSupportedCurrency(code)).toBe(true);
      expect(currencyOptions('').some((c) => c.code === code)).toBe(true);
    }
    expect(currencyOptions('gibraltar').map((c) => c.code)).toEqual(['GIP']);
  });
});
