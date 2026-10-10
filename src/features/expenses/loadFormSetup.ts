import { db } from '@/db/client';
import { isGroupLost, LOST_ACCESS_MESSAGE } from '@/db/repositories/access';
import { getExpense, groupCategoryLabels } from '@/db/repositories/expenses';
import { getGroup } from '@/db/repositories/groups';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
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
    }
  | { ok: false; message: string };

/** Everything the add/edit expense screens need, read once when the screen opens. */
export function loadFormSetup(groupId: string, expenseId: string | null): FormSetup {
  if (!getGroup(db, groupId)) return { ok: false, message: 'This group no longer exists.' };
  if (isGroupLost(db, groupId)) return { ok: false, message: LOST_ACCESS_MESSAGE };

  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };

  const detail = expenseId ? getExpense(db, expenseId) : null;
  if (expenseId && (!detail || detail.expense.deletedAt !== null || detail.expense.groupId !== groupId)) {
    return { ok: false, message: 'This expense no longer exists.' };
  }

  // Active members, plus anyone who left but is already on the expense being edited.
  const involved = new Set([...(detail?.payers ?? []), ...(detail?.shares ?? [])].map((l) => l.memberId));
  const members = groupMembersQuery(db, groupId)
    .all()
    .filter((m) => m.deletedAt === null || involved.has(m.id))
    .map((m) => ({ id: m.id, name: m.id === me ? 'You' : m.displayName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me)); // "You" first

  const memberIds = members.map((m) => m.id);
  const initialState = detail
    ? formStateFromExpense(detail, memberIds, me)
    : initialFormState(memberIds, me, todayIsoDate());

  return { ok: true, me, members, initialState, categorySuggestions: groupCategoryLabels(db, groupId) };
}