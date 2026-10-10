import { router } from 'expo-router';

import type { AppDb } from '@/db/context';
import { editableGroups } from '@/db/repositories/editableGroups';
import type { Group } from '@/db/schema';

export { editableGroups };

export type AddExpenseTarget =
  | { kind: 'createGroup' }
  | { kind: 'group'; groupId: string }
  | { kind: 'pick' };

/** No group → create one first; exactly one → straight to its form; several → ask which. */
export function addExpenseTarget(groups: readonly Group[]): AddExpenseTarget {
  if (groups.length === 0) return { kind: 'createGroup' };
  if (groups.length === 1) return { kind: 'group', groupId: groups[0]!.id };
  return { kind: 'pick' };
}

/** The centre "+" tab. */
export function openAddExpense(db: AppDb, deviceUserId: string): void {
  const target = addExpenseTarget(editableGroups(db, deviceUserId));
  if (target.kind === 'createGroup') router.push('/groups/new');
  else if (target.kind === 'group')
    router.push({ pathname: '/groups/[groupId]/expenses/new', params: { groupId: target.groupId } });
  else router.push('/pick-group');
}
