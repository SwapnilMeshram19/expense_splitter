import {
  MAX_DESCRIPTION_LENGTH,
  isValidCalendarDate,
  validateExpense,
  type ExpenseInput,
} from '../expenseValidation';

const members = new Set(['a', 'b', 'c']);

const base: ExpenseInput = {
  description: '  Dinner   at  Goa ',
  amountPaise: 900,
  expenseDate: '2026-10-01',
  payers: [
    { memberId: 'a', amountPaise: 900 },
    { memberId: 'b', amountPaise: 0 },
  ],
  splitInput: { type: 'equal', memberIds: ['a', 'b', 'c'] },
};

const withInput = (overrides: Partial<ExpenseInput>) => validateExpense({ ...base, ...overrides }, members);

describe('validateExpense', () => {
  it('normalizes description, drops zero payers and returns shares', () => {
    expect(validateExpense(base, members)).toEqual({
      ok: true,
      description: 'Dinner at Goa',
      payers: [{ memberId: 'a', amountPaise: 900 }],
      shares: [
        { memberId: 'a', amountPaise: 300 },
        { memberId: 'b', amountPaise: 300 },
        { memberId: 'c', amountPaise: 300 },
      ],
      originalPayers: null,
    });
  });

  it.each<[string, Partial<ExpenseInput>, object]>([
    ['blank description', { description: '   ' }, { code: 'DESCRIPTION_REQUIRED' }],
    [
      'long description',
      { description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) },
      { code: 'DESCRIPTION_TOO_LONG', max: MAX_DESCRIPTION_LENGTH },
    ],
    ['impossible date', { expenseDate: '2026-02-30' }, { code: 'INVALID_DATE' }],
    ['split error', { amountPaise: 0 }, { code: 'SPLIT', error: { code: 'INVALID_TOTAL' } }],
    ['no payers', { payers: [] }, { code: 'INVALID_PAYERS' }],
    [
      'duplicate payer',
      {
        payers: [
          { memberId: 'a', amountPaise: 450 },
          { memberId: 'a', amountPaise: 450 },
        ],
      },
      { code: 'INVALID_PAYERS' },
    ],
    ['blank payer id', { payers: [{ memberId: '', amountPaise: 900 }] }, { code: 'INVALID_PAYERS' }],
    [
      'negative payer',
      {
        payers: [
          { memberId: 'a', amountPaise: 1000 },
          { memberId: 'b', amountPaise: -100 },
        ],
      },
      { code: 'INVALID_PAYERS' },
    ],
    [
      'fractional payer',
      {
        payers: [
          { memberId: 'a', amountPaise: 899.5 },
          { memberId: 'b', amountPaise: 0.5 },
        ],
      },
      { code: 'INVALID_PAYERS' },
    ],
    [
      'payer sum mismatch',
      { payers: [{ memberId: 'a', amountPaise: 800 }] },
      { code: 'PAYER_SUM_MISMATCH', expected: 900, actual: 800 },
    ],
    [
      'unknown payer',
      { payers: [{ memberId: 'z', amountPaise: 900 }] },
      { code: 'UNKNOWN_MEMBER', memberId: 'z' },
    ],
    [
      'unknown member in equal split',
      { splitInput: { type: 'equal', memberIds: ['a', 'z'] } },
      { code: 'UNKNOWN_MEMBER', memberId: 'z' },
    ],
    [
      'unknown zero-valued member in exact split',
      {
        splitInput: {
          type: 'exact',
          entries: [
            { memberId: 'a', value: 900 },
            { memberId: 'z', value: 0 },
          ],
        },
      },
      { code: 'UNKNOWN_MEMBER', memberId: 'z' },
    ],
    [
      'unknown member in percentage split',
      {
        splitInput: {
          type: 'percentage',
          entries: [
            { memberId: 'a', value: 10000 },
            { memberId: 'z', value: 0 },
          ],
        },
      },
      { code: 'UNKNOWN_MEMBER', memberId: 'z' },
    ],
    [
      'unknown member in shares split',
      {
        splitInput: {
          type: 'shares',
          entries: [
            { memberId: 'a', value: 1 },
            { memberId: 'z', value: 1 },
          ],
        },
      },
      { code: 'UNKNOWN_MEMBER', memberId: 'z' },
    ],
    [
      'unknown member in itemized split',
      { splitInput: { type: 'itemized', items: [{ amountPaise: 900, memberIds: ['a', 'z'] }] } },
      { code: 'UNKNOWN_MEMBER', memberId: 'z' },
    ],
  ])('rejects %s', (_label, overrides, expected) => {
    expect(withInput(overrides)).toEqual({ ok: false, error: expected });
  });
});

describe('isValidCalendarDate', () => {
  it.each(['2026-10-01', '2024-02-29', '2026-12-31'])('accepts %s', (value) => {
    expect(isValidCalendarDate(value)).toBe(true);
  });

  it.each(['2025-02-29', '2026-13-01', '2026-00-10', '2026-1-1', '0099-01-01', '01-10-2026', ''])(
    'rejects %p',
    (value) => {
      expect(isValidCalendarDate(value)).toBe(false);
    },
  );
});
describe('validateExpense: currencies', () => {
  const usdBill: ExpenseInput = {
    description: 'Dinner in Dubai',
    // $30.00 at 83.333 → ₹2,499.99
    amountPaise: 249999,
    expenseDate: '2026-10-01',
    payers: [
      { memberId: 'a', amountPaise: 2000 },
      { memberId: 'b', amountPaise: 1000 },
    ],
    splitInput: { type: 'equal', memberIds: ['a', 'b', 'c'] },
    currency: 'INR',
    foreign: { currency: 'USD', amountMinor: 3000, rate: '83.333' },
  };

  it('splits in the bill currency and converts shares and payers to sum exactly', () => {
    const result = validateExpense(usdBill, members);
    expect(result).toEqual({
      ok: true,
      description: 'Dinner in Dubai',
      payers: [
        { memberId: 'a', amountPaise: 166666 },
        { memberId: 'b', amountPaise: 83333 },
      ],
      shares: [
        { memberId: 'a', amountPaise: 83333 },
        { memberId: 'b', amountPaise: 83333 },
        { memberId: 'c', amountPaise: 83333 },
      ],
      originalPayers: [
        { memberId: 'a', amountPaise: 2000 },
        { memberId: 'b', amountPaise: 1000 },
      ],
    });
  });

  it('checks the converted total the client claims', () => {
    expect(validateExpense({ ...usdBill, amountPaise: 250000 }, members)).toEqual({
      ok: false,
      error: { code: 'FX_TOTAL_MISMATCH', expected: 249999, actual: 250000 },
    });
  });

  it('checks payers in the bill currency', () => {
    expect(
      validateExpense({ ...usdBill, payers: [{ memberId: 'a', amountPaise: 249999 }] }, members),
    ).toEqual({ ok: false, error: { code: 'PAYER_SUM_MISMATCH', expected: 3000, actual: 249999 } });
  });

  it('validates exact splits against the bill total', () => {
    const exact = validateExpense(
      {
        ...usdBill,
        splitInput: {
          type: 'exact',
          entries: [
            { memberId: 'a', value: 2500 },
            { memberId: 'b', value: 500 },
          ],
        },
      },
      members,
    );
    expect(exact.ok && exact.shares).toEqual([
      { memberId: 'a', amountPaise: 208333 },
      { memberId: 'b', amountPaise: 41666 },
    ]);
  });

  it('rejects bad foreign data and unknown currencies', () => {
    expect(validateExpense({ ...usdBill, currency: 'XYZ' }, members)).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_CURRENCY' },
    });
    expect(
      validateExpense(
        { ...usdBill, foreign: { currency: 'INR', amountMinor: 3000, rate: '1' } },
        members,
      ),
    ).toEqual({ ok: false, error: { code: 'FX', error: { code: 'FX_SAME_CURRENCY' } } });
    expect(
      validateExpense(
        { ...usdBill, foreign: { currency: 'USD', amountMinor: 3000, rate: '83.3330' } },
        members,
      ),
    ).toEqual({
      ok: false,
      error: { code: 'FX', error: { code: 'FX_INVALID_RATE', error: 'NOT_CANONICAL' } },
    });
  });

  it('uses the group currency cap for plain expenses', () => {
    // ¥9,000,000 fits the JPY cap (¥1 crore); ¥20,000,000 does not.
    const jpy: ExpenseInput = {
      description: 'Ryokan',
      amountPaise: 9_000_000,
      expenseDate: '2026-10-01',
      payers: [{ memberId: 'a', amountPaise: 9_000_000 }],
      splitInput: { type: 'equal', memberIds: ['a', 'b'] },
      currency: 'JPY',
    };
    expect(validateExpense(jpy, members).ok).toBe(true);
    expect(
      validateExpense(
        { ...jpy, amountPaise: 20_000_000, payers: [{ memberId: 'a', amountPaise: 20_000_000 }] },
        members,
      ),
    ).toEqual({
      ok: false,
      error: { code: 'SPLIT', error: { code: 'INVALID_TOTAL' } },
    });
    // High-denomination group: Rp 50 crore-ish amounts are allowed.
    const idr = {
      ...jpy,
      currency: 'IDR',
      amountPaise: 500_000_000_000,
      payers: [{ memberId: 'a', amountPaise: 500_000_000_000 }],
    };
    expect(validateExpense(idr, members).ok).toBe(true);
  });

  it('handles zero-digit bills converted into a three-digit group', () => {
    // ¥1,000 at 0.00205 KWD = KWD 2.050
    const result = validateExpense(
      {
        description: 'Taxi',
        amountPaise: 2050,
        expenseDate: '2026-10-01',
        payers: [{ memberId: 'a', amountPaise: 1000 }],
        splitInput: { type: 'equal', memberIds: ['a', 'b', 'c'] },
        currency: 'KWD',
        foreign: { currency: 'JPY', amountMinor: 1000, rate: '0.00205' },
      },
      members,
    );
    expect(result.ok && result.shares).toEqual([
      { memberId: 'a', amountPaise: 685 },
      { memberId: 'b', amountPaise: 683 },
      { memberId: 'c', amountPaise: 682 },
    ]);
  });
});