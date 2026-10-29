import { router } from 'expo-router';

import { dataStore } from '@/data';
import { findSelfMemberId } from '@/data/selectors';
import type { Group, GroupSnapshot } from '@/domain/model';

export type AddExpenseTarget =
  | { kind: 'createGroup' }
  | { kind: 'group'; groupId: string }
  | { kind: 'pick' };

/** Groups I can add to (I'm an active member), in the order the store lists them. */
export function editableGroups(snapshots: readonly GroupSnapshot[], userId: string): Group[] {
  return snapshots.filter((s) => findSelfMemberId(s, userId) !== null).map((s) => s.group);
}

/** No group → create one first; exactly one → straight to its form; several → ask which. */
export function addExpenseTarget(groups: readonly Group[]): AddExpenseTarget {
  if (groups.length === 0) return { kind: 'createGroup' };
  if (groups.length === 1) return { kind: 'group', groupId: groups[0]!.id };
  return { kind: 'pick' };
}

/** The centre "+" tab. */
export function openAddExpense(): void {
  const store = dataStore();
  const target = addExpenseTarget(editableGroups(store.groups(), store.planningUserId()));
  if (target.kind === 'createGroup') router.push('/groups/new');
  else if (target.kind === 'group')
    router.push({ pathname: '/groups/[groupId]/expenses/new', params: { groupId: target.groupId } });
  else router.push('/pick-group');
}
