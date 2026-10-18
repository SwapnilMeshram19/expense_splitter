import { eq } from 'drizzle-orm';

import type { AppDb } from '../context';
import { settings } from '../schema';

/**
 * Ids of example groups that builds up to 1.0.0 created on first launch (this phone only). The app
 * no longer makes them; removeLegacySampleGroups() deletes any left over at startup.
 *
 * Kept in the local settings table (never synced) and still read by the sync engine, which leaves
 * these groups out of every push: if the cleanup ever fails, example data still can't reach the
 * server. Lives in its own module with no repository imports, like access.ts, so the engine can
 * read it without an import cycle.
 */
export const SAMPLE_GROUP_IDS_KEY = 'sample_group_ids';

export function sampleGroupIds(db: AppDb): Set<string> {
  const raw = db.select().from(settings).where(eq(settings.key, SAMPLE_GROUP_IDS_KEY)).get()?.value;
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export const isSampleGroup = (db: AppDb, groupId: string): boolean => sampleGroupIds(db).has(groupId);
