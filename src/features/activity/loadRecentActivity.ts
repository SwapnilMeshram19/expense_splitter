import { findSelfMemberId } from '@/data/selectors';
import type { ActivityEntry, GroupSnapshot } from '@/domain/model';

import { describeActivity, formatTimestamp, type ActivityView } from './describeActivity';

export interface RecentActivityItem extends ActivityView {
  id: string;
  groupId: string;
  groupName: string;
  time: string;
  createdAt: number;
}

/**
 * History across all my groups, newest first, for the Activity tab: entries as the server sent
 * them, described with each group's names and currency. Entries of groups I'm no longer in are
 * left out.
 */
export function loadRecentActivity(
  entries: readonly ActivityEntry[],
  groups: readonly GroupSnapshot[],
  userId: string,
): RecentActivityItem[] {
  const contexts = new Map(
    groups.map((s) => {
      const names = new Map(s.members.map((m) => [m.id, m.displayName]));
      return [
        s.group.id,
        {
          groupName: s.group.name,
          ctx: { me: findSelfMemberId(s, userId), nameOf: (id: string) => names.get(id) ?? 'Someone', currency: s.group.currency },
        },
      ] as const;
    }),
  );

  return entries.flatMap((entry) => {
    const c = contexts.get(entry.groupId);
    if (!c) return [];
    return [
      {
        id: entry.id,
        groupId: entry.groupId,
        groupName: c.groupName,
        createdAt: entry.createdAt,
        time: formatTimestamp(entry.createdAt),
        ...describeActivity(entry, c.ctx),
      },
    ];
  });
}
