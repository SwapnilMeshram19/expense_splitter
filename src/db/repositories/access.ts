import { eq } from 'drizzle-orm';

import type { AppDb } from '../context';
import { settings } from '../schema';

/**
 * Settings key holding the ids of groups the server says this account lost access to. Lives here
 * (not in the sync engine, which writes it) so repositories don't import the engine: that made a
 * require cycle access → engine → recurring → access.
 */
export const SYNC_LOST_GROUPS_KEY = 'sync_lost_group_ids';

export const LOST_ACCESS_MESSAGE =
  'You no longer have access to this group, so it can’t be changed.';

/**
 * True when the last sync found that the server no longer shows us this group (we were removed).
 * Such a group is read-only on this phone. Live: being added back clears it on the next sync.
 */
export function isGroupLost(db: AppDb, groupId: string): boolean {
  const raw = db.select().from(settings).where(eq(settings.key, SYNC_LOST_GROUPS_KEY)).get()?.value;
  if (!raw) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.includes(groupId);
  } catch {
    return false;
  }
}
