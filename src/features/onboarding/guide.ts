import { notInArray } from 'drizzle-orm';

import type { RepoContext } from '@/db/context';
import { getSetting, setSetting } from '@/db/repositories/profile';
import { sampleGroupIds } from '@/db/repositories/sampleIds';
import { groups } from '@/db/schema';

/** Set once the first-run guide was shown (or skipped for someone who already has groups). */
export const GUIDE_SEEN_KEY = 'guide_seen';

/**
 * True only on a phone that has never seen the guide and has no group of its own. Anyone who
 * already has a group, even a deleted one, isn't new: they're marked as having seen it, so an
 * update never greets an existing user with a tutorial. Leftover example groups don't count.
 */
export function shouldShowGuide(ctx: RepoContext): boolean {
  if (getSetting(ctx, GUIDE_SEEN_KEY)) return false;
  const sample = [...sampleGroupIds(ctx.db)];
  const own = ctx.db
    .select({ id: groups.id })
    .from(groups)
    .where(sample.length > 0 ? notInArray(groups.id, sample) : undefined)
    .limit(1)
    .get();
  if (own) {
    markGuideSeen(ctx);
    return false;
  }
  return true;
}

/** Marked when the guide opens, so closing the app halfway never brings it back. */
export function markGuideSeen(ctx: RepoContext): void {
  setSetting(ctx, GUIDE_SEEN_KEY, '1');
}
