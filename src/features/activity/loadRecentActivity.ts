import { desc, eq, isNull } from 'drizzle-orm';

import type { AppDb } from '@/db/context';
import { ACTIVITY_PAGE_SIZE } from '@/db/repositories/activity';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { activityLog, groups } from '@/db/schema';

import { describeActivity, formatTimestamp, type ActivityView } from './describeActivity';

export interface RecentActivityItem extends ActivityView {
  id: string;
  groupId: string;
  groupName: string;
  time: string;
  createdAt: number;
}

/**
 * Latest changes across all my groups, newest first, for the Activity tab.
 * Capped like the per-group screen; the sort has no covering index (only group_id+created_at),
 * which is fine at a few thousand rows on-device. Add an index on created_at if that grows.
 */
export function loadRecentActivity(
  db: AppDb,
  deviceUserId: string,
  limit: number = ACTIVITY_PAGE_SIZE,
): RecentActivityItem[] {
  const rows = db
    .select({ entry: activityLog, groupName: groups.name, currency: groups.currency })
    .from(activityLog)
    .innerJoin(groups, eq(activityLog.groupId, groups.id))
    .where(isNull(groups.deletedAt))
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(limit)
    .all();

  // One members query and one "me" lookup per group, not per row.
  const perGroup = new Map<
    string,
    { me: string | null; nameOf: (id: string) => string; currency: string }
  >();
  const contextFor = (groupId: string, currency: string) => {
    let context = perGroup.get(groupId);
    if (!context) {
      const names = new Map(groupMembersQuery(db, groupId).all().map((m) => [m.id, m.displayName]));
      context = {
        me: findSelfMemberId(db, groupId, deviceUserId),
        nameOf: (id: string) => names.get(id) ?? 'Someone',
        currency,
      };
      perGroup.set(groupId, context);
    }
    return context;
  };

  return rows.map(({ entry, groupName, currency }) => ({
    id: entry.id,
    groupId: entry.groupId,
    groupName,
    createdAt: entry.createdAt,
    time: formatTimestamp(entry.createdAt),
    ...describeActivity(entry, contextFor(entry.groupId, currency)),
  }));
}

export const RECENT_ACTIVITY_TABLES = ['activity_log', 'members', 'groups'] as const;
