import { budgetStatus, countsTowards, parseBudget } from '../budget';

describe('budgets', () => {
  it('reports spent, remaining and level', () => {
    const trip = { limit: 6_000_000, period: 'total' as const };
    expect(budgetStatus(trip, 4_200_000, '2026-10-10')).toEqual({
      limit: 6_000_000,
      period: 'total',
      spent: 4_200_000,
      remaining: 1_800_000,
      ratio: 0.7,
      level: 'ok',
      month: null,
    });
    expect(budgetStatus(trip, 4_800_000, '2026-10-10').level).toBe('near');
    expect(budgetStatus(trip, 6_000_000, '2026-10-10').level).toBe('near'); // exactly at the limit
    expect(budgetStatus(trip, 6_000_001, '2026-10-10')).toMatchObject({
      level: 'over',
      remaining: -1,
    });
    expect(budgetStatus({ limit: 100, period: 'monthly' }, 0, '2026-10-10').month).toBe('2026-10');
  });

  it('counts the whole trip, or only this month', () => {
    expect(countsTowards('total', '2025-01-01', '2026-10-10')).toBe(true);
    expect(countsTowards('monthly', '2026-10-31', '2026-10-10')).toBe(true);
    expect(countsTowards('monthly', '2026-09-30', '2026-10-10')).toBe(false);
  });

  it('parses stored values defensively', () => {
    expect(parseBudget(500, 'monthly')).toEqual({ limit: 500, period: 'monthly' });
    expect(parseBudget(null, null)).toBeNull();
    expect(parseBudget(0, 'total')).toBeNull();
    expect(parseBudget(500, 'weekly')).toBeNull();
    expect(parseBudget(1.5, 'total')).toBeNull();
  });
});
