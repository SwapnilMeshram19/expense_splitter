import {
  ACTIVITY_AD_AFTER,
  ACTIVITY_AD_MIN_ITEMS,
  ACTIVITY_AD_ROW,
  chooseAdUnit,
  isAdRow,
  shouldShowHomeAd,
  withActivityAd,
} from '../adPolicy';

const TEST_UNIT = 'ca-app-pub-3940256099942544/9214589741';
const REAL_UNIT = 'ca-app-pub-1234567890123456/1234567890';

describe('chooseAdUnit', () => {
  it('always uses the test unit in development, even when a real one is configured', () => {
    expect(chooseAdUnit('development', REAL_UNIT, TEST_UNIT)).toBe(TEST_UNIT);
    expect(chooseAdUnit('development', undefined, TEST_UNIT)).toBe(TEST_UNIT);
  });

  it('uses the configured unit in production', () => {
    expect(chooseAdUnit('production', ` ${REAL_UNIT} `, TEST_UNIT)).toBe(REAL_UNIT);
  });

  it('shows no ad in production when the unit is missing or malformed, never a test ad', () => {
    expect(chooseAdUnit('production', undefined, TEST_UNIT)).toBeNull();
    expect(chooseAdUnit('production', '', TEST_UNIT)).toBeNull();
    // An app ID (tilde) pasted where a unit ID (slash) belongs.
    expect(
      chooseAdUnit('production', 'ca-app-pub-1234567890123456~1234567890', TEST_UNIT),
    ).toBeNull();
  });
});

describe('shouldShowHomeAd', () => {
  it('waits for a real group: nobody exploring the example sees ads', () => {
    expect(shouldShowHomeAd(0)).toBe(false);
    expect(shouldShowHomeAd(1)).toBe(true);
  });
});

describe('withActivityAd', () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a${i}` }));

  it('adds nothing to short lists', () => {
    expect(withActivityAd(list(ACTIVITY_AD_MIN_ITEMS - 1), true)).toEqual(
      list(ACTIVITY_AD_MIN_ITEMS - 1),
    );
  });

  it('adds nothing until ads are ready', () => {
    expect(withActivityAd(list(30), false)).toEqual(list(30));
  });

  it('inserts exactly one ad after the 8th entry of a long list', () => {
    const rows = withActivityAd(list(ACTIVITY_AD_MIN_ITEMS), true);
    expect(rows).toHaveLength(ACTIVITY_AD_MIN_ITEMS + 1);
    expect(rows.filter(isAdRow)).toHaveLength(1);
    expect(rows[ACTIVITY_AD_AFTER]).toBe(ACTIVITY_AD_ROW);
    expect(rows[ACTIVITY_AD_AFTER - 1]).toEqual({ id: `a${ACTIVITY_AD_AFTER - 1}` });
  });

  it('never mutates the input', () => {
    const items = list(20);
    withActivityAd(items, true);
    expect(items).toHaveLength(20);
  });

  it('gives the ad row a key no activity item can have', () => {
    expect(isAdRow({ id: 'ad-activity' })).toBe(false);
    expect(isAdRow(null)).toBe(false);
    expect(ACTIVITY_AD_ROW.id).toBe('ad-activity');
  });
});
