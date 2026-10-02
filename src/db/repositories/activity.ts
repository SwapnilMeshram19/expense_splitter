import { desc, eq } from 'drizzle-orm';

import type { AppDb } from '../context';
import { activityLog } from '../schema';

export const ACTIVITY_PAGE_SIZE = 200;

/** Latest activity of a group, newest first. */
export const groupActivityQuery = (db: AppDb, groupId: string, limit: number = ACTIVITY_PAGE_SIZE) =>
  db
    .select()
    .from(activityLog)
    .where(eq(activityLog.groupId, groupId))
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(limit);