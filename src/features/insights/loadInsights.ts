import { budgetStatusOf, findSelfMemberId } from '@/data/selectors';
import { ledgerOf, type Group, type GroupSnapshot } from '@/domain/model';
import { computeBalances, isValidExpense } from '@/domain/balances';
import type { BudgetStatus } from '@/domain/budget';
import { toLocalIsoDate } from '@/lib/dates';

import type { InsightExpense, InsightMember, InsightSettlement } from './compute';

export interface InsightsSource {
  group: Group;
  me: string | null;
  members: InsightMember[];
  /** Valid, non-deleted expenses, oldest first. */
  expenses: InsightExpense[];
  /** Non-deleted payments, oldest first. */
  settlements: InsightSettlement[];
  /** Current balances (same numbers as the group screen). */
  balances: Map<string, number>;
  budget: BudgetStatus | null;
  /** Expenses left out because their lines don't add up (same as the group screen's warning). */
  invalidCount: number;
}

/**
 * Everything the insights screen and the exports need for one group, read once. The aggregation
 * itself (compute.ts) runs on this in memory: a group has hundreds of expenses, not millions, and
 * keeping it in TypeScript means the screen, CSV and PDF can't disagree with each other.
 */
export function loadInsightsSource(
  snapshot: GroupSnapshot | null,
  userId: string,
  today: string,
): InsightsSource | null {
  if (!snapshot) return null;
  const group = snapshot.group;

  const ledger = ledgerOf(snapshot);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);
  const lines = new Map(ledger.expenses.map((e) => [e.id, e]));

  let invalidCount = 0;
  const expenses: InsightExpense[] = [];
  for (const row of snapshot.expenses) {
    const line = lines.get(row.id) ?? { id: row.id, payers: [], shares: [] };
    if (!isValidExpense(line)) {
      invalidCount += 1;
      continue;
    }
    expenses.push({
      id: row.id,
      date: row.expenseDate,
      createdAt: row.createdAt,
      description: row.description,
      category: row.category,
      categoryLabel: row.categoryLabel,
      amount: row.amountPaise,
      originalCurrency: row.originalCurrency,
      originalAmountMinor: row.originalAmountMinor,
      note: row.note,
      payers: line.payers,
      shares: line.shares,
    });
  }
  // The query is newest first; reports and charts read oldest first.
  expenses.reverse();

  const settlements: InsightSettlement[] = snapshot.settlements
    .map((s) => ({
      id: s.id,
      date: toLocalIsoDate(new Date(s.settledAt)),
      createdAt: s.createdAt,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amount: s.amountPaise,
      method: s.method,
      note: s.note,
    }))
    .reverse();

  return {
    group,
    me: findSelfMemberId(snapshot, userId),
    members: snapshot.members.map((m) => ({ id: m.id, name: m.displayName, active: m.deletedAt === null })),
    expenses,
    settlements,
    balances,
    budget: budgetStatusOf(snapshot, today),
    invalidCount,
  };
}
