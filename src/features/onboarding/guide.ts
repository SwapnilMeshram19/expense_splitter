import { count } from 'drizzle-orm';

import type { RepoContext } from '@/db/context';
import { getSetting, setSetting } from '@/db/repositories/profile';
import { groups } from '@/db/schema';

/** Set once the first-run guide was shown (or skipped for someone who already has groups). */
export const GUIDE_SEEN_KEY = 'guide_seen';

/**
 * True only for someone who has never seen the guide and has no group: none from the server
 * (`groupCount`, what the data store holds) and none left in this phone's pre-1.1 tables. Anyone
 * with a group isn't new: they're marked as having seen it, so an update never greets an existing
 * user with a tutorial.
 */
export function shouldShowGuide(ctx: RepoContext, groupCount: number): boolean {
  if (getSetting(ctx, GUIDE_SEEN_KEY)) return false;
  const legacy = ctx.db.select({ n: count() }).from(groups).get()?.n ?? 0;
  if (groupCount > 0 || legacy > 0) {
    markGuideSeen(ctx);
    return false;
  }
  return true;
}

/** Marked when the guide opens, so closing the app halfway never brings it back. */
export function markGuideSeen(ctx: RepoContext): void {
  setSetting(ctx, GUIDE_SEEN_KEY, '1');
}
