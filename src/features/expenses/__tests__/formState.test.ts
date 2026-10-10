import type { Expense } from '@/db/schema';

import {
  analyzeForm,
  basisPointsToText,
  effectiveRateText,
  formStateFromExpense,
  initialFormState,
  sanitizeSplitInput,
  withCurrency,
  type ExpenseFormState,
} from '../formState';

const members = ['a', 'b', 'c'];
const base = (patch: Partial<ExpenseFormState> = {}): ExpenseFormState => ({
  ...initialFormState(members, 'a', '2026-10-01'),
  description: 'Dinner',
  amountText: '9',
  ...patch,
});

const expenseRow = (patch: Partial<Expense>): Expense => ({
  id: 'e1',
  groupId: 'g1',
  description: 'Dinner',
  amountPaise: 10000,
  category: 'food',
  categoryLabel: null,
  expenseDate: '2026-10-01',
  splitInput: { type: 'equal', memberIds: members },
  originalCurrency: null,
  originalAmountMinor: null,
  fxRate: null,
  createdByMemberId: 'a',
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  version: 0,
  dirty: true,
  ...patch,
});

describe('initialFormState', () => {
  it('defaults to me paying, equal split among everyone, one share each', () => {
    const state = initialFormState(members, 'a', '2026-10-01');
    expect(state.singlePayerId).toBe('a');
    expect(state.equalMemberIds).toEqual(members);
    expect(state.shares).toEqual({ a: '1', b: '1', c: '1' });
  });
});

describe('analyzeForm', () => {
  it('builds a draft with a live preview for a valid equal split', () => {
    const result = analyzeForm(base(), members);
    expect(result.problems).toEqual([]);
    expect([...result.preview.values()]).toEqual([300, 300, 300]);
    expect(result.draft).toEqual({
      description: 'Dinner',
      amountPaise: 900,
      expenseDate: '2026-10-01',
      category: 'general',
      categoryLabel: null,
      payers: [{ memberId: 'a', amountPaise: 900 }],
      splitInput: { type: 'equal', memberIds: members },
    });
  });

  it('reports missing description and amount', () => {
    const result = analyzeForm(base({ description: ' ', amountText: '' }), members);
    expect(result.problems).toEqual(['Enter a description.', 'Enter an amount.']);
    expect(result.draft).toBeNull();
  });

  it('requires at least one person in an equal split', () => {
    const result = analyzeForm(base({ equalMemberIds: [] }), members);
    expect(result.splitHint).toBe('Select at least one person.');
    expect(result.draft).toBeNull();
  });

  it('shows remaining and overflow for exact amounts', () => {
    const under = analyzeForm(base({ amountText: '100', splitMode: 'exact', exactAmounts: { a: '60' } }), members);
    expect(under.splitHint).toBe('₹40 left to assign');
    expect(under.problems).toContain('Fix the split: ₹40 left to assign');

    const over = analyzeForm(
      base({ amountText: '100', splitMode: 'exact', exactAmounts: { a: '60', b: '50' } }),
      members,
    );
    expect(over.splitHint).toBe('₹10 over the total');
  });

  it('shows remaining percentage', () => {
    const result = analyzeForm(
      base({ splitMode: 'percentage', percentages: { a: '33.33', b: '33.33', c: '33.33' } }),
      members,
    );
    expect(result.splitHint).toBe('0.01% left');
    expect(result.draft).toBeNull();
  });

  it('validates shares', () => {
    expect(
      analyzeForm(base({ splitMode: 'shares', shares: { a: '1.5' } }), members).splitHint,
    ).toBe('Shares must be whole numbers.');
    expect(
      analyzeForm(base({ splitMode: 'shares', shares: { a: '0', b: '', c: '' } }), members)
        .splitHint,
    ).toBe('Give at least one person a share.');
    const valid = analyzeForm(
      base({ amountText: '1000', splitMode: 'shares', shares: { a: '2', b: '1', c: '1' } }),
      members,
    );
    expect([...valid.preview.values()]).toEqual([50000, 25000, 25000]);
  });

  it('tracks how much is still unpaid with multiple payers', () => {
    const partial = analyzeForm(
      base({ amountText: '100', payerMode: 'multiple', payerAmounts: { a: '50' } }),
      members,
    );
    expect(partial.payerHint).toBe('₹50 still unpaid');
    expect(partial.draft).toBeNull();

    const complete = analyzeForm(
      base({ amountText: '100', payerMode: 'multiple', payerAmounts: { a: '50', b: '50' } }),
      members,
    );
    expect(complete.draft?.payers).toEqual([
      { memberId: 'a', amountPaise: 5000 },
      { memberId: 'b', amountPaise: 5000 },
    ]);
  });
});

describe('formStateFromExpense', () => {
  it('round-trips a percentage split exactly', () => {
    const splitInput = {
      type: 'percentage' as const,
      entries: [
        { memberId: 'a', value: 3333 },
        { memberId: 'b', value: 3333 },
        { memberId: 'c', value: 3334 },
      ],
    };
    const state = formStateFromExpense(
      { expense: expenseRow({ splitInput }), payers: [{ memberId: 'b', amountPaise: 10000 }], shares: [] },
      members,
      'a',
    );
    expect(state.splitMode).toBe('percentage');
    expect(state.percentages).toEqual({ a: '33.33', b: '33.33', c: '33.34' });
    expect(state.singlePayerId).toBe('b');
    expect(analyzeForm(state, members).draft?.splitInput).toEqual(splitInput);
  });

  it('opens multi-payer expenses in multiple mode', () => {
    const state = formStateFromExpense(
      {
        expense: expenseRow({}),
        payers: [
          { memberId: 'a', amountPaise: 6000 },
          { memberId: 'b', amountPaise: 4000 },
        ],
        shares: [],
      },
      members,
      'a',
    );
    expect(state.payerMode).toBe('multiple');
    expect(state.payerAmounts).toEqual({ a: '60', b: '40' });
  });
});

describe('helpers', () => {
  it('formats basis points', () => {
    expect(basisPointsToText(1250)).toBe('12.5');
    expect(basisPointsToText(5000)).toBe('50');
    expect(basisPointsToText(1)).toBe('0.01');
  });

  it('sanitizes per-mode input', () => {
    expect(sanitizeSplitInput('percentage', '33.333', '33.33')).toBe('33.33');
    expect(sanitizeSplitInput('shares', '2.5', '2')).toBe('2');
    expect(sanitizeSplitInput('exact', '12.505', '12.50')).toBe('12.50');
  });
});
describe('foreign bills', () => {
  const usd = (patch: Partial<ExpenseFormState> = {}) =>
    base({ currency: 'USD', amountText: '30', ...patch });

  it('uses today’s suggested rate until the user types one', () => {
    const result = analyzeForm(usd(), members, 'INR', '96.64');
    expect(result.problems).toEqual([]);
    expect(result.entryCurrency).toBe('USD');
    expect(result.convertedTotal).toBe(289920);
    expect([...result.preview.values()]).toEqual([1000, 1000, 1000]);
    expect(result.draft).toMatchObject({
      amountPaise: 289920,
      payers: [{ memberId: 'a', amountPaise: 3000 }],
      foreign: { currency: 'USD', amountMinor: 3000, rate: '96.64' },
    });

    const typed = analyzeForm(usd({ rateText: '98.5', rateEdited: true }), members, 'INR', '96.64');
    expect(typed.draft?.foreign?.rate).toBe('98.5');
    expect(effectiveRateText(usd({ rateText: '98.5', rateEdited: true }), '96.64')).toBe('98.5');
  });

  it('asks for a rate when none is known', () => {
    const result = analyzeForm(usd(), members, 'INR', null);
    expect(result.problems).toEqual(['Enter the exchange rate: how much is 1 USD in INR?']);
    expect(result.draft).toBeNull();
    expect(analyzeForm(usd({ rateText: '0', rateEdited: true }), members, 'INR').problems).toEqual([
      'Enter a valid exchange rate.',
    ]);
  });

  it('reports totals that are too large or round to zero in the group currency', () => {
    expect(analyzeForm(usd({ amountText: '200000' }), members, 'INR', '96.64').problems).toEqual([
      'That’s more than ₹1,00,00,000 in INR. Split it into smaller expenses.',
    ]);
    expect(
      analyzeForm(base({ currency: 'IDR', amountText: '1' }), members, 'KWD', '0.0000187').problems,
    ).toEqual(['That rounds to KWD 0 in KWD. Check the amount and rate.']);
  });

  it('formats hints and validates amounts in the bill currency', () => {
    const jpy = analyzeForm(
      base({ currency: 'JPY', amountText: '1000', splitMode: 'exact', exactAmounts: { a: '600' } }),
      members,
      'INR',
      '0.6107',
    );
    expect(jpy.splitHint).toBe('¥400 left to assign');
    expect(
      analyzeForm(base({ currency: 'JPY', amountText: '10.5' }), members, 'INR', '0.6').problems[0],
    ).toBe('Enter a valid amount (up to ¥10,000,000, no decimals).');
  });

  it('switches currency, trimming decimals the new currency can’t hold and resetting the rate', () => {
    const state = usd({
      amountText: '12.75',
      rateText: '98',
      rateEdited: true,
      payerAmounts: { a: '1.5' },
    });
    const yen = withCurrency(state, 'JPY');
    expect(yen).toMatchObject({
      currency: 'JPY',
      amountText: '12',
      rateText: '',
      rateEdited: false,
      payerAmounts: { a: '1' },
    });
    expect(withCurrency(yen, 'JPY')).toBe(yen);
    expect(withCurrency(base({ amountText: '5.5' }), 'KWD').amountText).toBe('5.5');
  });

  it('round-trips a saved foreign bill in its own currency with the locked rate', () => {
    const state = formStateFromExpense(
      {
        expense: expenseRow({
          amountPaise: 289920,
          originalCurrency: 'USD',
          originalAmountMinor: 3000,
          fxRate: '96.64',
          splitInput: {
            type: 'exact',
            entries: [
              { memberId: 'a', value: 2000 },
              { memberId: 'b', value: 1000 },
            ],
          },
        }),
        payers: [
          { memberId: 'a', amountPaise: 193280 },
          { memberId: 'b', amountPaise: 96640 },
        ],
        originalPayers: [
          { memberId: 'a', amountPaise: 2000 },
          { memberId: 'b', amountPaise: 1000 },
        ],
        shares: [],
      },
      members,
      'a',
      'INR',
    );
    expect(state).toMatchObject({
      currency: 'USD',
      amountText: '30',
      rateText: '96.64',
      rateEdited: true,
      payerMode: 'multiple',
      payerAmounts: { a: '20', b: '10' },
      exactAmounts: { a: '20', b: '10' },
    });
    // Saving it unchanged produces the same bill (rate stays locked even if today's differs).
    expect(analyzeForm(state, members, 'INR', '99').draft?.foreign).toEqual({
      currency: 'USD',
      amountMinor: 3000,
      rate: '96.64',
    });
  });

  it('sanitizes split amounts per currency', () => {
    expect(sanitizeSplitInput('exact', '12.5', '', 'JPY')).toBe('');
    expect(sanitizeSplitInput('exact', '1.255', '', 'KWD')).toBe('1.255');
  });

  it('falls back to the group currency for a bill currency this build doesn’t know', () => {
    const result = analyzeForm(base({ currency: 'XYZ', amountText: '9' }), members, 'INR');
    expect(result.entryCurrency).toBe('INR');
    expect(result.draft?.amountPaise).toBe(900);
  });
});