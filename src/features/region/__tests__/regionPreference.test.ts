import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { getSetting } from '@/db/repositories/profile';
import { formatMoney, usesIndianGroupingForInr } from '@/domain/currency';

import {
  detectHomeCurrency,
  getRegionPreference,
  HOME_CURRENCY_KEY,
  loadRegionPreference,
  prefersIndianGrouping,
  resetRegionPreferenceForTests,
  resolveRegionPreference,
  setHomeCurrency,
} from '../regionPreference';

const us = [{ regionCode: 'US', currencyCode: 'USD' }];
const india = [{ regionCode: 'IN', currencyCode: 'INR' }];

let t: TestContext;
beforeEach(() => {
  t = createTestContext();
});
afterEach(() => {
  t.close();
  resetRegionPreferenceForTests();
});

describe('detection', () => {
  it('takes the first supported, current currency from the phone, else INR', () => {
    expect(detectHomeCurrency(us)).toBe('USD');
    expect(detectHomeCurrency(india)).toBe('INR');
    expect(
      detectHomeCurrency([
        { regionCode: 'BG', currencyCode: 'BGN' }, // retired → skipped
        { regionCode: 'DE', currencyCode: 'EUR' },
      ]),
    ).toBe('EUR');
    expect(detectHomeCurrency([{ regionCode: null, currencyCode: null }])).toBe('INR');
    expect(detectHomeCurrency([])).toBe('INR');
  });

  it('uses lakh/crore grouping for India or an unknown region only', () => {
    expect(prefersIndianGrouping(india)).toBe(true);
    expect(prefersIndianGrouping([])).toBe(true);
    expect(prefersIndianGrouping([{ regionCode: null, currencyCode: 'USD' }])).toBe(true);
    expect(prefersIndianGrouping(us)).toBe(false);
    expect(prefersIndianGrouping([{ regionCode: 'GB', currencyCode: 'GBP' }, ...india])).toBe(false);
  });

  it('prefers a saved choice, ignoring unknown or retired codes', () => {
    expect(resolveRegionPreference('GBP', us)).toEqual({
      homeCurrency: 'GBP',
      homeIsAutomatic: false,
      detectedCurrency: 'USD',
      indianGrouping: false,
    });
    expect(resolveRegionPreference('XYZ', us).homeCurrency).toBe('USD');
    expect(resolveRegionPreference('BGN', us)).toMatchObject({ homeCurrency: 'USD', homeIsAutomatic: true });
  });
});

describe('store', () => {
  it('a US visitor gets USD and thousands grouping for rupees', () => {
    loadRegionPreference(t.ctx, us);
    expect(getRegionPreference()).toMatchObject({ homeCurrency: 'USD', homeIsAutomatic: true });
    expect(usesIndianGroupingForInr()).toBe(false);
    expect(formatMoney(10_000_000, 'INR')).toBe('₹100,000');

    loadRegionPreference(t.ctx, india);
    expect(formatMoney(10_000_000, 'INR')).toBe('₹1,00,000');
  });

  it('saves a chosen currency locally and can go back to automatic', () => {
    setHomeCurrency(t.ctx, 'THB', us);
    expect(getSetting(t.ctx, HOME_CURRENCY_KEY)).toBe('THB');
    expect(getRegionPreference()).toMatchObject({ homeCurrency: 'THB', homeIsAutomatic: false });

    setHomeCurrency(t.ctx, 'NOPE', us); // ignored
    expect(getRegionPreference().homeCurrency).toBe('THB');

    setHomeCurrency(t.ctx, null, us);
    expect(getSetting(t.ctx, HOME_CURRENCY_KEY)).toBeNull();
    expect(getRegionPreference()).toMatchObject({ homeCurrency: 'USD', homeIsAutomatic: true });
  });
});
