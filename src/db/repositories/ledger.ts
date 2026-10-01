import { and, eq, isNull } from 'drizzle-orm';

import type { LedgerExpense, LedgerSettlement } from '@/domain/balances';

import type { AppDb } from '../context';
import { expensePayers, expenseShares, expenses, settlements } from '../schema';

export interface GroupLedger {
  expenses: LedgerExpense[];
  settlements: LedgerSettlement[];
}

/**
 * Load everything computeBalances / computePairwiseDebts need for one group:
 * active expenses with their lines, and active settlements. Three queries total,
 * regardless of the number of expenses.
 */
export function loadGroupLedger(db: AppDb, groupId: string): GroupLedger {
  const activeExpense = and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt));

  const payerRows = db
    .select({
      expenseId: expensePayers.expenseId,
      memberId: expensePayers.memberId,
      amountPaise: expensePayers.amountPaise,
    })
    .from(expensePayers)
    .innerJoin(expenses, eq(expensePayers.expenseId, expenses.id))
    .where(activeExpense)
    .all();

  const shareRows = db
    .select({
      expenseId: expenseShares.expenseId,
      memberId: expenseShares.memberId,
      amountPaise: expenseShares.amountPaise,
    })
    .from(expenseShares)
    .innerJoin(expenses, eq(expenseShares.expenseId, expenses.id))
    .where(activeExpense)
    .all();

  const byId = new Map<string, { id: string; payers: LedgerExpense['payers'][number][]; shares: LedgerExpense['shares'][number][] }>();
  const entry = (id: string) => {
    let e = byId.get(id);
    if (!e) {
      e = { id, payers: [], shares: [] };
      byId.set(id, e);
    }
    return e;
  };
  for (const r of payerRows) entry(r.expenseId).payers.push({ memberId: r.memberId, amountPaise: r.amountPaise });
  for (const r of shareRows) entry(r.expenseId).shares.push({ memberId: r.memberId, amountPaise: r.amountPaise });

  const settlementRows = db
    .select({
      id: settlements.id,
      fromMemberId: settlements.fromMemberId,
      toMemberId: settlements.toMemberId,
      amountPaise: settlements.amountPaise,
    })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)))
    .all();

  return { expenses: [...byId.values()], settlements: settlementRows };
}