/**
 * Reads over one group snapshot: what the SQLite repositories used to answer, now computed from
 * the server's data. Pure and synchronous.
 */
import { computeBalances, type PayerLine } from '@/domain/balances';
import { budgetStatus, monthOf, parseBudget, type Budget, type BudgetStatus } from '@/domain/budget';
import { categoryLabelKey } from '@/domain/categoryLabel';
import {
  ledgerOf,
  originalPayersOf,
  selfMember,
  type Expense,
  type GroupSnapshot,
  type Member,
  type RecurringRule,
  type Settlement,
} from '@/domain/model';
import type { ShareLine } from '@/domain/splits';

export interface ExpenseDetail {
  expense: Expense;
  /** Group currency. */
  payers: PayerLine[];
  /** Group currency. */
  shares: ShareLine[];
  /** Foreign bills: who paid in the bill's currency; null otherwise. */
  originalPayers: PayerLine[] | null;
}

/** My member id in the group, or null. */
export const findSelfMemberId = (s: GroupSnapshot, userId: string | null): string | null => selfMember(s, userId)?.id ?? null;

/** All members including those who left, in the order they joined. */
export const membersOf = (s: GroupSnapshot): Member[] => s.members;

export const activeMembersOf = (s: GroupSnapshot): Member[] => s.members.filter((m) => m.deletedAt === null);

export const memberOf = (s: GroupSnapshot, memberId: string | undefined): Member | null =>
  (memberId && s.members.find((m) => m.id === memberId.toLowerCase() && m.deletedAt === null)) || null;

export function balancesOf(s: GroupSnapshot): Map<string, number> {
  const ledger = ledgerOf(s);
  return computeBalances(ledger.expenses, ledger.settlements).balances;
}

export function expenseDetailOf(s: GroupSnapshot, expenseId: string): ExpenseDetail | null {
  const expense = s.expenses.find((e) => e.id === expenseId.toLowerCase());
  if (!expense) return null;
  return {
    expense,
    payers: expense.payers.map((p) => ({ memberId: p.memberId, amountPaise: p.amountPaise })),
    shares: expense.shares,
    originalPayers: originalPayersOf(expense),
  };
}

export const settlementOf = (s: GroupSnapshot, settlementId: string): Settlement | null =>
  s.settlements.find((x) => x.id === settlementId.toLowerCase()) ?? null;

export const ruleOf = (s: GroupSnapshot, ruleId: string): RecurringRule | null =>
  s.rules.find((r) => r.id === ruleId.toLowerCase()) ?? null;

export const ruleHasOccurrences = (s: GroupSnapshot, ruleId: string): boolean =>
  s.rulesWithOccurrences.includes(ruleId.toLowerCase());

/** Why a rule can't create its next expense (someone on it has left), or null. */
export function ruleProblem(s: GroupSnapshot, rule: RecurringRule): 'MEMBER_LEFT' | null {
  const active = new Set(activeMembersOf(s).map((m) => m.id));
  return [...rule.payers, ...rule.shares].every((l) => active.has(l.memberId)) ? null : 'MEMBER_LEFT';
}

export const groupBudget = (s: GroupSnapshot): Budget | null => parseBudget(s.group.budgetPaise, s.group.budgetPeriod);

/** Progress against the budget on `today` ('YYYY-MM-DD'): expenses only, in the group currency. */
export function budgetStatusOf(s: GroupSnapshot, today: string): BudgetStatus | null {
  const budget = groupBudget(s);
  if (!budget) return null;
  const month = monthOf(today);
  const spent = s.expenses
    .filter((e) => budget.period !== 'monthly' || monthOf(e.expenseDate) === month)
    .reduce((sum, e) => sum + e.amountPaise, 0);
  return budgetStatus(budget, spent, today);
}

/** Custom category names used in the group, most used first (latest spelling wins). */
export function categoryLabelsOf(s: GroupSnapshot, limit = 8): string[] {
  const rows = s.expenses
    .filter((e) => e.category === 'other' && e.categoryLabel)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const counts = new Map<string, { label: string; count: number }>();
  for (const e of rows) {
    const key = categoryLabelKey(e.categoryLabel!);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { label: e.categoryLabel!, count: 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => e.label);
}

/** Foreign currencies used for bills in the group, most recently changed first. */
export function billCurrenciesOf(s: GroupSnapshot, limit = 4): string[] {
  const rows = s.expenses.filter((e) => e.originalCurrency).sort((a, b) => b.updatedAt - a.updatedAt);
  return [...new Set(rows.map((e) => e.originalCurrency!))].slice(0, limit);
}

/** Receipt ids the group's expenses point at. */
export const receiptIdsOf = (s: GroupSnapshot): Set<string> =>
  new Set(s.expenses.flatMap((e) => (e.receiptId ? [e.receiptId] : [])));
