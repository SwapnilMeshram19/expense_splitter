import { expenseDetailOf } from '@/data/selectors';
import type { GroupSnapshot } from '@/domain/model';
import { categoryDisplayName } from '@/features/expenses/categoryNames';

import { expenseMessage } from './messages';

/** The WhatsApp text for one expense, from the group as shown now; null if it's gone. */
export function expenseShareText(snapshot: GroupSnapshot | null, expenseId: string): string | null {
  if (!snapshot) return null;
  const detail = expenseDetailOf(snapshot, expenseId);
  if (!detail) return null;
  const { expense } = detail;
  const group = snapshot.group;

  const names = new Map(snapshot.members.map((m) => [m.id, m.displayName]));
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
