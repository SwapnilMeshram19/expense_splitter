import {
  CURRENCIES,
  POPULAR_CURRENCIES,
  currencyInfo,
  currencyLabel,
  currencyPrefix,
  formatMoney,
  formatMoneyCompact,
  formatMoneyList,
  isSupportedCurrency,
  maxAmountLabel,
  maxAmountMinor,
  MAX_AMOUNT_MINOR_ANY,
  minorDigits,
  minorToInputString,
  parseAmount,
  sanitizeMoneyInput,
} from '../currency';
import { formatPaise, MAX_AMOUNT_PAISE } from '../money';

describe('currency table', () => {
  it('parses every line, sorted and unique', () => {
    expect(CURRENCIES.length).toBeGreaterThan(140);
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(codes);
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/);
      expect([0, 2, 3]).toContain(c.digits);
      expect(c.name.length).toBeGreaterThan(2);
    }
  });

  it('uses ISO 4217 minor units', () => {
    expect(minorDigits('INR')).toBe(2);
    expect(minorDigits('JPY')).toBe(0);
    expect(minorDigits('KRW')).toBe(0);
    expect(minorDigits('VND')).toBe(0);
    expect(minorDigits('KWD')).toBe(3);
    expect(minorDigits('BHD')).toBe(3);
    expect(minorDigits('OMR')).toBe(3);
    expect(minorDigits('IDR')).toBe(2);
  });

  it('lists only supported popular currencies, INR first', () => {
    expect(POPULAR_CURRENCIES[0]).toBe('INR');
    for (const code of POPULAR_CURRENCIES) expect(isSupportedCurrency(code)).toBe(true);
  });

  it('rejects unknown codes and non-strings', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false);
    expect(isSupportedCurrency('inr')).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
    expect(isSupportedCurrency(42)).toBe(false);
  });

  it('degrades gracefully for codes from a newer build', () => {
    expect(currencyInfo('XYZ')).toEqual({
      code: 'XYZ',
      digits: 2,
      symbol: '',
      name: 'XYZ',
      high: false,
    });
    expect(formatMoney(1250, 'XYZ')).toBe('XYZ 12.50');
  });

  it('labels and prefixes', () => {
    expect(currencyPrefix('INR')).toBe('₹');
    expect(currencyPrefix('USD')).toBe('$');
    expect(currencyPrefix('AED')).toBe('AED');
    expect(currencyLabel('USD')).toBe('USD · US dollar');
  });
});

describe('maxAmountMinor', () => {
  it('keeps ₹1 crore for INR', () => {
    expect(maxAmountMinor('INR')).toBe(MAX_AMOUNT_PAISE);
    expect(maxAmountLabel('INR')).toBe('₹1,00,00,000');
  });

  it('scales by minor digits and denomination', () => {
    expect(maxAmountMinor('USD')).toBe(10_000_000 * 100);
    expect(maxAmountMinor('JPY')).toBe(10_000_000);
    expect(maxAmountMinor('KWD')).toBe(10_000_000 * 1000);
    expect(maxAmountMinor('VND')).toBe(10_000_000_000);
    // High denomination with 2 digits hits the server-wide ceiling.
    expect(maxAmountMinor('IDR')).toBe(MAX_AMOUNT_MINOR_ANY);
    expect(maxAmountMinor('IQD')).toBe(MAX_AMOUNT_MINOR_ANY);
  });

  it('never exceeds the server ceiling', () => {
    for (const c of CURRENCIES)
      expect(maxAmountMinor(c.code)).toBeLessThanOrEqual(MAX_AMOUNT_MINOR_ANY);
  });
});

describe('formatMoney', () => {
  it('is formatPaise for INR (lakh/crore)', () => {
    for (const n of [0, 5, 100, 12345678, -250, 10_00_000_00]) {
      expect(formatMoney(n, 'INR')).toBe(formatPaise(n));
      expect(formatMoney(n, 'INR', { forceDecimals: true })).toBe(
        formatPaise(n, { forceDecimals: true }),
      );
    }
    expect(formatMoney(12345678, 'INR')).toBe('₹1,23,456.78');
  });

  it('groups thousands elsewhere', () => {
    expect(formatMoney(12345678, 'USD')).toBe('$123,456.78');
    expect(formatMoney(100000, 'USD')).toBe('$1,000');
    expect(formatMoney(100000, 'USD', { forceDecimals: true })).toBe('$1,000.00');
    expect(formatMoney(1234567, 'JPY')).toBe('¥1,234,567');
    expect(formatMoney(1234567, 'JPY', { forceDecimals: true })).toBe('¥1,234,567');
    expect(formatMoney(1250, 'KWD')).toBe('KWD 1.250');
    expect(formatMoney(1000, 'KWD')).toBe('KWD 1');
    expect(formatMoney(5, 'KWD', { forceDecimals: true })).toBe('KWD 0.005');
    expect(formatMoney(-4550, 'EUR')).toBe('-€45.50');
    expect(formatMoney(4550, 'EUR', { symbol: false })).toBe('45.50');
    expect(formatMoney(0, 'GBP')).toBe('£0');
  });

  it('throws on non-integers', () => {
    expect(() => formatMoney(1.5, 'USD')).toThrow(RangeError);
  });

  it('compacts', () => {
    expect(formatMoneyCompact(15_00_000_00, 'INR')).toBe('₹15L');
    expect(formatMoneyCompact(1_250_000, 'USD')).toBe('$12.5K');
    expect(formatMoneyCompact(340_000_000, 'USD')).toBe('$3.4M');
    expect(formatMoneyCompact(150_000_000_000, 'IDR')).toBe('Rp1.5B');
    expect(formatMoneyCompact(-2_000_000, 'JPY')).toBe('-¥2M');
    expect(formatMoneyCompact(99_900, 'USD')).toBe('$999');
  });

  it('builds input strings', () => {
    expect(minorToInputString(24950, 'USD')).toBe('249.50');
    expect(minorToInputString(10000, 'USD')).toBe('100');
    expect(minorToInputString(1500000, 'JPY')).toBe('1500000');
    expect(minorToInputString(1234567, 'INR')).toBe('12345.67');
  });

  it('joins multi-currency totals', () => {
    expect(
      formatMoneyList([
        { currency: 'INR', minor: 120000 },
        { currency: 'USD', minor: 0 },
        { currency: 'USD', minor: 4550 },
      ]),
    ).toBe('₹1,200 + $45.50');
    expect(formatMoneyList([])).toBe('');
  });
});

describe('parseAmount', () => {
  it('delegates INR to parseRupeesToPaise', () => {
    expect(parseAmount('₹ 1,23,456.78', 'INR')).toEqual({ ok: true, minor: 12345678 });
    expect(parseAmount('1.234', 'INR')).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
  });

  it('respects minor digits', () => {
    expect(parseAmount('12.5', 'USD')).toEqual({ ok: true, minor: 1250 });
    expect(parseAmount('$1,234.56', 'USD')).toEqual({ ok: true, minor: 123456 });
    expect(parseAmount('1500', 'JPY')).toEqual({ ok: true, minor: 1500 });
    expect(parseAmount('15.5', 'JPY')).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
    expect(parseAmount('1.250', 'KWD')).toEqual({ ok: true, minor: 1250 });
    expect(parseAmount('1.2505', 'KWD')).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
    expect(parseAmount('AED 50', 'AED')).toEqual({ ok: true, minor: 5000 });
    expect(parseAmount('Rp 150.000', 'IDR')).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
    expect(parseAmount('Rp 150,000', 'IDR')).toEqual({ ok: true, minor: 15_000_000 });
  });

  it('rejects empty, invalid, zero and too large', () => {
    expect(parseAmount('', 'USD')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseAmount('.', 'USD')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseAmount('-5', 'USD')).toEqual({ ok: false, error: 'INVALID' });
    expect(parseAmount('1e5', 'USD')).toEqual({ ok: false, error: 'INVALID' });
    expect(parseAmount('0.00', 'USD')).toEqual({ ok: false, error: 'ZERO' });
    expect(parseAmount('10000000.01', 'USD')).toEqual({ ok: false, error: 'TOO_LARGE' });
    expect(parseAmount('99999999999999999999', 'JPY')).toEqual({ ok: false, error: 'TOO_LARGE' });
    expect(parseAmount('10000000', 'USD')).toEqual({ ok: true, minor: 1_000_000_000 });
  });
});

describe('sanitizeMoneyInput', () => {
  it('limits decimals per currency', () => {
    expect(sanitizeMoneyInput('12.34', '', 'USD')).toBe('12.34');
    expect(sanitizeMoneyInput('12.345', '12.34', 'USD')).toBe('12.34');
    expect(sanitizeMoneyInput('12.', '', 'JPY')).toBe('');
    expect(sanitizeMoneyInput('1200', '', 'JPY')).toBe('1200');
    expect(sanitizeMoneyInput('1.234', '', 'KWD')).toBe('1.234');
    expect(sanitizeMoneyInput('1,000', '', 'USD')).toBe('1000');
    expect(sanitizeMoneyInput('', 'x', 'USD')).toBe('');
  });

  it('limits whole digits by the cap', () => {
    expect(sanitizeMoneyInput('12345678', '', 'USD')).toBe('12345678');
    expect(sanitizeMoneyInput('123456789', 'prev', 'USD')).toBe('prev');
    expect(sanitizeMoneyInput('12345678901', '', 'IDR')).toBe('12345678901');
    // INR behaves exactly like sanitizeAmountInput (8 rupee digits).
    expect(sanitizeMoneyInput('₹123456789', 'prev', 'INR')).toBe('prev');
  });
});
