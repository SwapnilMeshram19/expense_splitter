import type { AppDb } from '@/db/context';
import { groupExpensesQuery } from '@/db/repositories/expenses';
import { getGroup, groupBudgetStatus } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { groupSettlementsQuery } from '@/db/repositories/settlements';
import type { Group } from '@/db/schema';
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
  db: AppDb,
  groupId: string,
  deviceUserId: string,
  today: string,
): InsightsSource | null {
  const group = getGroup(db, groupId);
  if (!group) return null;

  const ledger = loadGroupLedger(db, groupId);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);
  const lines = new Map(ledger.expenses.map((e) => [e.id, e]));

  let invalidCount = 0;
  const expenses: InsightExpense[] = [];
  for (const row of groupExpensesQuery(db, groupId).all()) {
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

  const settlements: InsightSettlement[] = groupSettlementsQuery(db, groupId)
    .all()
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
    me: findSelfMemberId(db, groupId, deviceUserId),
    members: groupMembersQuery(db, groupId)
      .all()
      .map((m) => ({ id: m.id, name: m.displayName, active: m.deletedAt === null })),
    expenses,
    settlements,
    balances,
    budget: groupBudgetStatus(db, group, today),
    invalidCount,
  };
}

export const INSIGHTS_TABLES = [
  'groups',
  'members',
  'expenses',
  'expense_payers',
  'expense_shares',
  'settlements',
] as const;
