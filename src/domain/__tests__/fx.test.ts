import { isSupportedCurrency } from '../currency';
import {
  convertLines,
  convertMinor,
  crossRate,
  decimalFromNumber,
  foreignTotal,
  formatRate,
  isCanonicalRate,
  parseRate,
  rateToFraction,
  sanitizeRateInput,
} from '../fx';
import { computeSplit } from '../splits';
import { mulberry32 } from '../../test-utils/prng';

describe('parseRate', () => {
  it('normalizes', () => {
    expect(parseRate('96.64')).toEqual({ ok: true, rate: '96.64' });
    expect(parseRate(' 0096.6400 ')).toEqual({ ok: true, rate: '96.64' });
    expect(parseRate('5.')).toEqual({ ok: true, rate: '5' });
    expect(parseRate('.5')).toEqual({ ok: true, rate: '0.5' });
    expect(parseRate('1,000.25')).toEqual({ ok: true, rate: '1000.25' });
    expect(parseRate('0.00000015')).toEqual({ ok: true, rate: '0.00000015' });
  });

  it('rejects bad input', () => {
    expect(parseRate('')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseRate('.')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseRate('abc')).toEqual({ ok: false, error: 'INVALID' });
    expect(parseRate('-1')).toEqual({ ok: false, error: 'INVALID' });
    expect(parseRate('1e3')).toEqual({ ok: false, error: 'INVALID' });
    expect(parseRate(96.64)).toEqual({ ok: false, error: 'INVALID' });
    expect(parseRate('0')).toEqual({ ok: false, error: 'ZERO' });
    expect(parseRate('0.000')).toEqual({ ok: false, error: 'ZERO' });
    expect(parseRate('0.000000000001')).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
    expect(parseRate('100000000000')).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
    expect(parseRate('1.000000000000001')).toEqual({ ok: false, error: 'TOO_PRECISE' });
    expect(parseRate('123456789.1234567')).toEqual({ ok: false, error: 'TOO_PRECISE' });
  });

  it('knows canonical form', () => {
    expect(isCanonicalRate('96.64')).toBe(true);
    expect(isCanonicalRate('96.640')).toBe(false);
    expect(isCanonicalRate('096.64')).toBe(false);
    expect(isCanonicalRate(null)).toBe(false);
  });

  it('exposes the exact fraction', () => {
    expect(rateToFraction('96.64')).toEqual({ num: 9664n, den: 100n });
    expect(rateToFraction('3')).toEqual({ num: 3n, den: 1n });
  });

  it('filters live input', () => {
    expect(sanitizeRateInput('96.6', '')).toBe('96.6');
    expect(sanitizeRateInput('96,6', '')).toBe('966');
    expect(sanitizeRateInput('9a', '9')).toBe('9');
    expect(sanitizeRateInput('', '9')).toBe('');
  });
});

describe('convertMinor', () => {
  it('handles digit differences between currencies', () => {
    expect(convertMinor(2500, '96.64', 'USD', 'INR')).toBe(241600); // $25 → ₹2,416
    expect(convertMinor(1000, '0.5612', 'JPY', 'INR')).toBe(56120); // ¥1,000 → ₹561.20
    expect(convertMinor(100000, '1.7819', 'INR', 'JPY')).toBe(1782); // ₹1,000 → ¥1,781.9 → ¥1,782
    expect(convertMinor(1250, '314.5', 'KWD', 'INR')).toBe(39313); // KWD 1.250 → ₹393.125 → ₹393.13
    expect(convertMinor(39313, '0.00318', 'INR', 'KWD')).toBe(1250); // ₹393.13 → KWD 1.2501534 → 1.250
  });

  it('rounds half up', () => {
    expect(convertMinor(1, '0.5', 'USD', 'EUR')).toBe(1);
    expect(convertMinor(1, '0.49', 'USD', 'EUR')).toBe(0);
    expect(convertMinor(3, '0.5', 'USD', 'EUR')).toBe(2);
  });

  it('rejects invalid amounts and overflow', () => {
    expect(() => convertMinor(-1, '1', 'USD', 'EUR')).toThrow(RangeError);
    expect(() => convertMinor(1.5, '1', 'USD', 'EUR')).toThrow(RangeError);
    expect(() => convertMinor(Number.MAX_SAFE_INTEGER, '10000000000', 'USD', 'EUR')).toThrow(
      RangeError,
    );
  });
});

describe('foreignTotal', () => {
  const known = isSupportedCurrency;

  it('converts a valid bill', () => {
    expect(
      foreignTotal({ currency: 'USD', amountMinor: 2500, rate: '96.64' }, 'INR', known),
    ).toEqual({
      ok: true,
      totalMinor: 241600,
    });
  });

  it('rejects every invalid case', () => {
    const t = (currency: string, amountMinor: number, rate: string, group = 'INR') =>
      foreignTotal({ currency, amountMinor, rate }, group, known);
    expect(t('INR', 100, '1')).toEqual({ ok: false, error: { code: 'FX_SAME_CURRENCY' } });
    expect(t('XYZ', 100, '1')).toEqual({ ok: false, error: { code: 'FX_UNKNOWN_CURRENCY' } });
    expect(t('USD', 0, '1')).toEqual({ ok: false, error: { code: 'FX_INVALID_AMOUNT' } });
    expect(t('USD', 1.5, '1')).toEqual({ ok: false, error: { code: 'FX_INVALID_AMOUNT' } });
    expect(t('USD', 1_000_000_001, '1')).toEqual({
      ok: false,
      error: { code: 'FX_INVALID_AMOUNT' },
    });
    expect(t('USD', 100, 'x')).toEqual({
      ok: false,
      error: { code: 'FX_INVALID_RATE', error: 'INVALID' },
    });
    expect(t('USD', 100, '96.640')).toEqual({
      ok: false,
      error: { code: 'FX_INVALID_RATE', error: 'NOT_CANONICAL' },
    });
    expect(t('IDR', 1, '0.0001')).toEqual({ ok: false, error: { code: 'FX_TOTAL_ZERO' } });
    // $2,00,000 at 96.64 = ₹1.93 crore, above the ₹1 crore cap.
    expect(t('USD', 20_000_000, '96.64')).toEqual({
      ok: false,
      error: { code: 'FX_TOTAL_TOO_LARGE', max: 1_00_00_000_00 },
    });
  });

  it('reports an overflowing conversion as too large', () => {
    const r = foreignTotal(
      { currency: 'IDR', amountMinor: 1_000_000_000_000, rate: '10000000000' },
      'USD',
      known,
    );
    expect(r).toEqual({ ok: false, error: { code: 'FX_TOTAL_TOO_LARGE', max: 1_000_000_000 } });
  });
});

describe('convertLines', () => {
  it('sums exactly to the converted total', () => {
    // $10 each for 3 people at 83.333: total ₹2,499.99 (249999 paise).
    const total = convertMinor(3000, '83.333', 'USD', 'INR');
    expect(total).toBe(249999);
    const lines = convertLines(total, [
      { memberId: 'a', amountPaise: 1000 },
      { memberId: 'b', amountPaise: 1000 },
      { memberId: 'c', amountPaise: 1000 },
    ]);
    expect(lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(total);
    expect(lines).toEqual([
      { memberId: 'a', amountPaise: 83333 },
      { memberId: 'b', amountPaise: 83333 },
      { memberId: 'c', amountPaise: 83333 },
    ]);
  });

  it('keeps zero lines at zero', () => {
    expect(
      convertLines(100, [
        { memberId: 'a', amountPaise: 1 },
        { memberId: 'b', amountPaise: 0 },
      ]),
    ).toEqual([
      { memberId: 'a', amountPaise: 100 },
      { memberId: 'b', amountPaise: 0 },
    ]);
  });

  it('throws when every line is zero', () => {
    expect(() => convertLines(100, [{ memberId: 'a', amountPaise: 0 }])).toThrow(RangeError);
  });

  it('property: shares always sum to the converted total, each within one unit of exact', () => {
    const rand = mulberry32(4242);
    const rates = ['96.64', '0.5612', '0.00318', '24321.5', '1.0857', '0.0000562'];
    const pairs: [string, string][] = [
      ['USD', 'INR'],
      ['JPY', 'INR'],
      ['INR', 'KWD'],
      ['USD', 'IDR'],
      ['EUR', 'USD'],
      ['IDR', 'EUR'],
    ];
    for (let i = 0; i < 500; i++) {
      const k = Math.floor(rand() * rates.length);
      const [from, to] = pairs[k]!;
      const rate = rates[k]!;
      const amount = 1 + Math.floor(rand() * 5_000_000);
      const people = ['a', 'b', 'c', 'd', 'e'].slice(0, 1 + Math.floor(rand() * 5));
      const split = computeSplit(
        amount,
        { type: 'equal', memberIds: people },
        Number.MAX_SAFE_INTEGER,
      );
      if (!split.ok) throw new Error('split failed');
      const total = convertMinor(amount, rate, from, to);
      if (total === 0) continue;
      const lines = convertLines(total, split.shares);
      expect(lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(total);
      for (const line of lines) {
        const share = split.shares.find((s) => s.memberId === line.memberId)!.amountPaise;
        expect(Math.abs(line.amountPaise - (total * share) / amount)).toBeLessThan(1);
      }
    }
  });
});

describe('rates from the daily table', () => {
  it('turns feed floats into decimal strings', () => {
    expect(decimalFromNumber(96.64)).toBe('96.64');
    expect(decimalFromNumber(0.1 + 0.2)).toBe('0.3');
    expect(decimalFromNumber(1.5e-7)).toBe('0.00000015');
    expect(decimalFromNumber(16450)).toBe('16450');
    expect(decimalFromNumber(1.23456789e21)).toBe('1234567890000000000000');
    expect(decimalFromNumber(3.6725)).toBe('3.6725');
    expect(decimalFromNumber(0)).toBeNull();
    expect(decimalFromNumber(-1)).toBeNull();
    expect(decimalFromNumber(Number.NaN)).toBeNull();
    expect(decimalFromNumber(Infinity)).toBeNull();
  });

  it('derives cross rates to 12 significant digits', () => {
    expect(crossRate('1', '96.64')).toBe('96.64'); // USD → INR
    expect(crossRate('96.64', '1')).toBe('0.0103476821192'); // INR → USD
    expect(crossRate('3.6725', '96.64')).toBe('26.3144996596'); // AED → INR
    expect(crossRate('158.24', '96.64')).toBe('0.610717896866'); // JPY → INR
    expect(crossRate('16450', '0.3071')).toBe('0.00001866869301'); // IDR → KWD, capped at 14 decimals
  });

  it('returns null for missing or invalid table values', () => {
    expect(crossRate(undefined, '96.64')).toBeNull();
    expect(crossRate('1', undefined)).toBeNull();
    expect(crossRate('x', '1')).toBeNull();
    expect(crossRate('1', '0')).toBeNull();
    // Ratio outside the accepted range.
    expect(crossRate('0.0000001', '1000000')).toBeNull();
  });

  it('formats rates for display', () => {
    expect(formatRate('96.64')).toBe('96.64');
    expect(formatRate('26.3144996596')).toBe('26.3144');
    expect(formatRate('3')).toBe('3');
    expect(formatRate('1.00001')).toBe('1');
    expect(formatRate('0.610717896866')).toBe('0.6107');
    expect(formatRate('0.00001866869301')).toBe('0.00001867');
    expect(formatRate('junk')).toBe('junk');
  });
});
