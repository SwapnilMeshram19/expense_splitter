import { eq } from 'drizzle-orm';

import { SYNC_LOST_GROUPS_KEY } from '@/sync/engine';

import type { AppDb } from '../context';
import { settings } from '../schema';

export const LOST_ACCESS_MESSAGE = 'You no longer have access to this group, so it can’t be changed.';

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