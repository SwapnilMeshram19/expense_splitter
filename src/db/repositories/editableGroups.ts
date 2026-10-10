import type { AppDb } from '../context';
import type { Group } from '../schema';
import { isGroupLost } from './access';
import { activeGroupsQuery } from './groups';
import { findSelfMemberId } from './members';

/**
 * Groups this phone can write to: I'm an active member and the server hasn't revoked access.
 * Most recently updated first. Used by the "+" button and for change-signal subscriptions.
 */
export function editableGroups(db: AppDb, deviceUserId: string): Group[] {
  return activeGroupsQuery(db)
    .all()
    .filter((group) => findSelfMemberId(db, group.id, deviceUserId) !== null && !isGroupLost(db, group.id));
}
