/**
 * Group budgets: a spending limit in minor units of the group currency, for the whole trip or for
 * each calendar month (flats: rent, groceries). Spent = the group's expenses (not payments), counted
 * by their expense date. Pure TypeScript (copied to the Edge Function).
 */

export const BUDGET_PERIODS = ['total', 'monthly'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const isBudgetPeriod = (value: unknown): value is BudgetPeriod =>
  typeof value === 'string' && (BUDGET_PERIODS as readonly string[]).includes(value);

/** Share of the budget at which the bar turns to a warning. */
export const BUDGET_WARN_RATIO = 0.8;

export interface Budget {
  limit: number;
  period: BudgetPeriod;
}

export interface BudgetStatus extends Budget {
  /** Spent in the period, minor units. */
  spent: number;
  /** limit − spent; negative when over. */
  remaining: number;
  /** spent / limit (can exceed 1). */
  ratio: number;
  level: 'ok' | 'near' | 'over';
  /** Monthly budgets: the month counted ('YYYY-MM'); null for a whole-trip budget. */
  month: string | null;
}

/** 'YYYY-MM' of a 'YYYY-MM-DD' date. */
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/** Expenses counted for a budget on `today`: all of them, or those dated in today's month. */
export const countsTowards = (period: BudgetPeriod, expenseDate: string, today: string): boolean =>
  period === 'total' || monthOf(expenseDate) === monthOf(today);

export function budgetStatus(budget: Budget, spent: number, today: string): BudgetStatus {
  const ratio = budget.limit > 0 ? spent / budget.limit : 0;
  return {
    ...budget,
    spent,
    remaining: budget.limit - spent,
    ratio,
    level: spent > budget.limit ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'near' : 'ok',
    month: budget.period === 'monthly' ? monthOf(today) : null,
  };
}

/** A budget as stored (both set, or neither); null when there is none or it's malformed. */
export function parseBudget(limit: unknown, period: unknown): Budget | null {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) return null;
  return isBudgetPeriod(period) ? { limit, period } : null;
}
