import { dataStore } from '@/data';
import { billCurrenciesOf, categoryLabelsOf, expenseDetailOf, findSelfMemberId } from '@/data/selectors';
import type { CurrencyCode } from '@/domain/currency';
import { todayIsoDate } from '@/lib/dates';

import {
  formStateFromExpense,
  initialFormState,
  type ExpenseFormState,
  type FormMember,
} from './formState';

export type FormSetup =
  | {
      ok: true;
      me: string;
      members: FormMember[];
      initialState: ExpenseFormState;
      /** Custom category names already used in this group, most used first. */
      categorySuggestions: string[];
      /** The group's currency: balances, payers and shares are always in it. */
      groupCurrency: CurrencyCode;
      /** Foreign currencies already used for bills in this group, most recent first. */
      recentCurrencies: CurrencyCode[];
      /** Editing an occurrence of a repeating expense: its rule (for the "Repeats" link). */
      recurringRuleId: string | null;
      /** Editing: the version the change is made on (someone else's newer change wins). */
      expectedVersion: number;
    }
  | { ok: false; message: string };

/** Everything the add/edit expense screens need, read once when the screen opens. */
export function loadFormSetup(groupId: string, expenseId: string | null): FormSetup {
  const store = dataStore();
  const snapshot = store.group(groupId);
  if (!snapshot) return { ok: false, message: 'This group no longer exists.' };

  const me = findSelfMemberId(snapshot, store.planningUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };

  const detail = expenseId ? expenseDetailOf(snapshot, expenseId) : null;
  if (expenseId && !detail) return { ok: false, message: 'This expense no longer exists.' };

  // Active members, plus anyone who left but is already on the expense being edited.
  const involved = new Set([...(detail?.payers ?? []), ...(detail?.shares ?? [])].map((l) => l.memberId));
  const members = snapshot.members
    .filter((m) => m.deletedAt === null || involved.has(m.id))
    .map((m) => ({ id: m.id, name: m.id === me ? 'You' : m.displayName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me)); // "You" first

  const currency = snapshot.group.currency;
  const memberIds = members.map((m) => m.id);
  const initialState = detail
    ? formStateFromExpense(detail, memberIds, me, currency)
    : initialFormState(memberIds, me, todayIsoDate(), currency);

  return {
    ok: true,
    me,
    members,
    initialState,
    categorySuggestions: categoryLabelsOf(snapshot),
    groupCurrency: currency,
    recentCurrencies: billCurrenciesOf(snapshot),
    recurringRuleId: detail?.expense.recurringRuleId ?? null,
    expectedVersion: detail?.expense.version ?? 0,
  };
}
