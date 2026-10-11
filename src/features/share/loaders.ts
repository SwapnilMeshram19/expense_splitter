import type { AppDb } from '@/db/context';
import { getExpense } from '@/db/repositories/expenses';
import { getGroup } from '@/db/repositories/groups';
import { groupMembersQuery } from '@/db/repositories/members';
import { categoryDisplayName } from '@/features/expenses/categoryNames';

import { expenseMessage } from './messages';

/** The WhatsApp text for one expense, read fresh at tap time; null if it's gone. */
export function expenseShareText(db: AppDb, expenseId: string): string | null {
  const detail = getExpense(db, expenseId);
  if (!detail || detail.expense.deletedAt !== null) return null;
  const { expense } = detail;
  const group = getGroup(db, expense.groupId);
  if (!group) return null;

  const names = new Map(
    groupMembersQuery(db, group.id)
      .all()
      .map((m) => [m.id, m.displayName]),
  );
  const name = (id: string) => names.get(id) ?? 'Someone';

  return expenseMessage({
    groupName: group.name,
    currency: group.currency,
    description: expense.description,
    amountPaise: expense.amountPaise,
    original:
      expense.originalCurrency && expense.originalAmountMinor !== null
        ? { currency: expense.originalCurrency, amountMinor: expense.originalAmountMinor }
        : null,
    date: expense.expenseDate,
    categoryName: categoryDisplayName(expense.category, expense.categoryLabel),
    note: expense.note,
    payers: detail.payers.map((p) => ({ name: name(p.memberId), amountPaise: p.amountPaise })),
    shares: [...detail.shares]
      .sort((a, b) => b.amountPaise - a.amountPaise)
      .map((s) => ({ name: name(s.memberId), amountPaise: s.amountPaise })),
  });
}
