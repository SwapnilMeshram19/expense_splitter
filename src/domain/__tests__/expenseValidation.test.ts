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