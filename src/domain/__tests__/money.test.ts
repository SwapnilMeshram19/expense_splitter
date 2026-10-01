import {
  MAX_AMOUNT_PAISE,
  formatPaise,
  formatPaiseCompact,
  paiseToInputString,
  parseRupeesToPaise,
  sanitizeAmountInput,
} from '../money';

describe('parseRupeesToPaise', () => {
  it.each([
    ['249', 24900],
    ['249.5', 24950],
    ['249.50', 24950],
    ['.5', 50],
    ['0.01', 1],
    ['₹ 1,23,456.78', 12345678],
    ['Rs. 100', 10000],
    ['rs100', 10000],
    ['007', 700],
    ['1,00,000', 10000000],
  ])('%s -> %s paise', (input, expected) => {
    expect(parseRupeesToPaise(input)).toEqual({ ok: true, paise: expected });
  });

  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['.', 'EMPTY'],
    ['-10', 'INVALID'],
    ['1.2.3', 'INVALID'],
    ['abc', 'INVALID'],
    ['12e3', 'INVALID'],
    ['1.005', 'TOO_MANY_DECIMALS'], // the classic float trap: 1.005 * 100 = 100.4999…
    ['0', 'ZERO'],
    ['0.00', 'ZERO'],
    ['100000001', 'TOO_LARGE'], // above ₹1 crore cap
    ['12345678901234', 'TOO_LARGE'], // 14 rupee digits, rejected before Number()
  ])('rejects %p with %s', (input, error) => {
    expect(parseRupeesToPaise(input)).toEqual({ ok: false, error });
  });

  it('accepts exactly the cap', () => {
    expect(parseRupeesToPaise('1,00,00,000')).toEqual({ ok: true, paise: MAX_AMOUNT_PAISE });
  });
});

describe('sanitizeAmountInput', () => {
  it('allows partial states while typing', () => {
    expect(sanitizeAmountInput('12', '1')).toBe('12');
    expect(sanitizeAmountInput('12.', '12')).toBe('12.');
    expect(sanitizeAmountInput('12.5', '12.')).toBe('12.5');
    expect(sanitizeAmountInput('.', '')).toBe('.');
  });

  it('strips symbols and grouping commas', () => {
    expect(sanitizeAmountInput('₹1,250', '')).toBe('1250');
  });

  it('returns empty string when cleared', () => {
    expect(sanitizeAmountInput('', '12')).toBe('');
  });

  it('blocks a third decimal, a second dot, letters, and too many digits', () => {
    expect(sanitizeAmountInput('12.505', '12.50')).toBe('12.50');
    expect(sanitizeAmountInput('12.5.', '12.5')).toBe('12.5');
    expect(sanitizeAmountInput('12a', '12')).toBe('12');
    expect(sanitizeAmountInput('123456789', '12345678')).toBe('12345678');
  });
});

describe('formatPaise', () => {
  it('uses Indian grouping and hides .00 for whole rupees', () => {
    expect(formatPaise(12345678)).toBe('₹1,23,456.78');
    expect(formatPaise(10000)).toBe('₹100');
    expect(formatPaise(100000)).toBe('₹1,000');
    expect(formatPaise(1000000000)).toBe('₹1,00,00,000');
    expect(formatPaise(50)).toBe('₹0.50');
    expect(formatPaise(5)).toBe('₹0.05');
    expect(formatPaise(0)).toBe('₹0');
  });

  it('formats negatives', () => {
    expect(formatPaise(-3334)).toBe('-₹33.34');
  });

  it('forces decimals and drops the symbol when asked', () => {
    expect(formatPaise(10000, { forceDecimals: true })).toBe('₹100.00');
    expect(formatPaise(12345678, { symbol: false })).toBe('1,23,456.78');
  });

  it('throws on non-integer paise (programmer error)', () => {
    expect(() => formatPaise(1.5)).toThrow(RangeError);
    expect(() => formatPaise(Number.NaN)).toThrow(RangeError);
  });
});

describe('formatPaiseCompact', () => {
  it('compacts to K / L / Cr', () => {
    expect(formatPaiseCompact(1250000)).toBe('₹12.5K'); // ₹12,500
    expect(formatPaiseCompact(120000000)).toBe('₹12L'); // ₹12,00,000
    expect(formatPaiseCompact(3450000000)).toBe('₹3.4Cr'); // ₹3,45,00,000
  });

  it('truncates instead of rounding up', () => {
    expect(formatPaiseCompact(9996000)).toBe('₹99.9K'); // ₹99,960 must not show ₹1L
  });

  it('falls back to full format below ₹1,000', () => {
    expect(formatPaiseCompact(95050)).toBe('₹950.50');
  });

  it('handles negatives', () => {
    expect(formatPaiseCompact(-1250000)).toBe('-₹12.5K');
  });
});

describe('paiseToInputString', () => {
  it('produces an editable value without symbol or commas', () => {
    expect(paiseToInputString(24950)).toBe('249.50');
    expect(paiseToInputString(10000)).toBe('100');
    expect(paiseToInputString(12345678)).toBe('123456.78');
  });

  it('round-trips through the parser', () => {
    for (const paise of [1, 50, 24950, 10000, 12345678, MAX_AMOUNT_PAISE]) {
      expect(parseRupeesToPaise(paiseToInputString(paise))).toEqual({ ok: true, paise });
    }
  });
});