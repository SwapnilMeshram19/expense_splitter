import { router } from 'expo-router';

import type { AppDb } from '@/db/context';
import { editableGroups } from '@/db/repositories/editableGroups';
import { sampleGroupIds } from '@/db/repositories/sampleIds';
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

/** "+" never targets a leftover example group from an old build (deleted at startup anyway). */
export function addExpenseGroups(groups: readonly Group[], sampleIds: ReadonlySet<string>): Group[] {
  return groups.filter((g) => !sampleIds.has(g.id));
}

/** The centre "+" tab. */
export function openAddExpense(db: AppDb, deviceUserId: string): void {
  const target = addExpenseTarget(addExpenseGroups(editableGroups(db, deviceUserId), sampleGroupIds(db)));
  if (target.kind === 'createGroup') router.push('/groups/new');
  else if (target.kind === 'group')
    router.push({ pathname: '/groups/[groupId]/expenses/new', params: { groupId: target.groupId } });
  else router.push('/pick-group');
}
