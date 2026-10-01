import { eq } from 'drizzle-orm';

import type { RepoContext } from '../context';
import { settings } from '../schema';

const DEVICE_USER_ID_KEY = 'device_user_id';

/**
 * Stable local identity for "me" on this device, used as members.user_id for the self
 * member. Phase 3 sign-in maps it to the real account id.
 */
export function getOrCreateDeviceUserId(ctx: RepoContext): string {
  const read = () =>
    ctx.db.select().from(settings).where(eq(settings.key, DEVICE_USER_ID_KEY)).get()?.value;

  const existing = read();
  if (existing) return existing;

  const id = ctx.newId();
  ctx.db.insert(settings).values({ key: DEVICE_USER_ID_KEY, value: id }).onConflictDoNothing().run();
  return read() ?? id;
}