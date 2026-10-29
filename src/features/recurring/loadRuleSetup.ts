import { dataStore } from '@/data';
import { categoryLabelsOf, findSelfMemberId, ruleHasOccurrences, ruleOf } from '@/data/selectors';
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
      /** The version the edit is made on. */
      expectedVersion: number;
      /** IANA zone the rule's days follow (kept when the rule is edited). */
      timeZone: string;
    }
  | { ok: false; message: string };

/** Everything the edit-repeating-expense screen needs, read once when it opens. */
export function loadRuleSetup(groupId: string, ruleId: string): RuleSetup {
  const store = dataStore();
  const snapshot = store.group(groupId);
  if (!snapshot) return { ok: false, message: 'This group no longer exists.' };
  const me = findSelfMemberId(snapshot, store.planningUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };
  const rule = ruleOf(snapshot, ruleId);
  if (!rule) return { ok: false, message: 'This repeating expense no longer exists.' };

  // Active members, plus anyone on the rule who has left (so the form shows why it's paused).
  const involved = new Set([...rule.payers, ...rule.shares].map((l) => l.memberId));
  const members = snapshot.members
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
      snapshot.group.currency,
    ),
    categorySuggestions: categoryLabelsOf(snapshot),
    groupCurrency: snapshot.group.currency,
    scheduleLocked: ruleHasOccurrences(snapshot, ruleId),
    expectedVersion: rule.version,
    timeZone: rule.timeZone,
  };
}
