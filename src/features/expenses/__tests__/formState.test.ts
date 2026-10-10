import type { Expense } from '@/db/schema';

import {
  analyzeForm,
  basisPointsToText,
  formStateFromExpense,
  initialFormState,
  sanitizeSplitInput,
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
    expect(analyzeForm(base({ splitMode: 'shares', shares: { a: '1.5' } }), members).splitHint).toBe(
      'Shares must be whole numbers.',
    );
    expect(
      analyzeForm(base({ splitMode: 'shares', shares: { a: '0', b: '', c: '' } }), members).splitHint,
    ).toBe('Give at least one person a share.');
    const valid = analyzeForm(base({ amountText: '1000', splitMode: 'shares', shares: { a: '2', b: '1', c: '1' } }), members);
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