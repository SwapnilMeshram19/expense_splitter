import { analyzeForm, initialFormState, type ExpenseFormState } from '../formState';

const members = ['a', 'b', 'c'];
const base = (patch: Partial<ExpenseFormState>): ExpenseFormState => ({
  ...initialFormState(members, 'a', '2026-10-01'),
  description: 'Dinner',
  ...patch,
});

describe('live previews while typing', () => {
  it('shows estimated amounts as soon as a percentage is typed', () => {
    const result = analyzeForm(
      base({ amountText: '1000', splitMode: 'percentage', percentages: { a: '50' } }),
      members,
    );
    expect(result.preview.get('a')).toBe(50000);
    expect(result.preview.has('b')).toBe(false);
    expect(result.previewIsEstimate).toBe(true);
    expect(result.draft).toBeNull();
  });

  it('switches to exact allocation once percentages reach 100%', () => {
    const result = analyzeForm(
      base({
        amountText: '100',
        splitMode: 'percentage',
        percentages: { a: '33.33', b: '33.33', c: '33.34' },
      }),
      members,
    );
    expect(result.previewIsEstimate).toBe(false);
    expect([...result.preview.values()]).toEqual([3333, 3333, 3334]);
    expect(result.draft).not.toBeNull();
  });

  it('shows typed amounts immediately in Amounts mode', () => {
    const result = analyzeForm(
      base({ amountText: '100', splitMode: 'exact', exactAmounts: { a: '60' } }),
      members,
    );
    expect(result.preview.get('a')).toBe(6000);
    expect(result.previewIsEstimate).toBe(false);
    expect(result.draft).toBeNull();
  });

  it('shows no percentage estimates without a total', () => {
    const result = analyzeForm(
      base({ amountText: '', splitMode: 'percentage', percentages: { a: '50' } }),
      members,
    );
    expect(result.preview.size).toBe(0);
  });
});