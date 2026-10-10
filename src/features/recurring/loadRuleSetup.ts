import { db } from '@/db/client';
import { isGroupLost, LOST_ACCESS_MESSAGE } from '@/db/repositories/access';
import { groupCategoryLabels } from '@/db/repositories/expenses';
import { getGroup } from '@/db/repositories/groups';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { getRule, ruleHasOccurrences } from '@/db/repositories/recurring';
import { getDeviceUserId } from '@/db/session';
import type { ExpenseFormState, FormMember } from '@/features/expenses/formState';

import { formStateFromRule } from './ruleForm';

export type RuleSetup =
  | {
      ok: true;
      me: string;
      members: FormMember[];
      initialState: ExpenseFormState;
      categorySuggestions: string[];
      groupCurrency: string;
      scheduleLocked: boolean;
    }
  | { ok: false; message: string };

/** Everything the edit-repeating-expense screen needs, read once when it opens. */
export function loadRuleSetup(groupId: string, ruleId: string): RuleSetup {
  const group = getGroup(db, groupId);
  if (!group) return { ok: false, message: 'This group no longer exists.' };
  if (isGroupLost(db, groupId)) return { ok: false, message: LOST_ACCESS_MESSAGE };
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };
  const rule = getRule(db, ruleId);
  if (!rule || rule.deletedAt !== null || rule.groupId !== groupId) {
    return { ok: false, message: 'This repeating expense no longer exists.' };
  }

  // Active members, plus anyone on the rule who has left (so the form shows why it's paused).
  const involved = new Set([...rule.payers, ...rule.shares].map((l) => l.memberId));
  const members = groupMembersQuery(db, groupId)
    .all()
    .filter((m) => m.deletedAt === null || involved.has(m.id))
    .map((m) => ({ id: m.id, name: m.id === me ? 'You' : m.displayName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me));

  return {
    ok: true,
    me,
    members,
    initialState: formStateFromRule(
      rule,
      members.map((m) => m.id),
      me,
      group.currency,
    ),
    categorySuggestions: groupCategoryLabels(db, groupId),
    groupCurrency: group.currency,
    scheduleLocked: ruleHasOccurrences(db, ruleId),
  };
}
