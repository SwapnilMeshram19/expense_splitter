import { eq } from 'drizzle-orm';

import type { RepoContext } from '../context';
import { settings } from '../schema';

export const DEVICE_USER_ID_KEY = 'device_user_id';
export const SELF_NAME_KEY = 'self_name';

export function getSetting(ctx: RepoContext, key: string): string | null {
  return ctx.db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(ctx: RepoContext, key: string, value: string): void {
  ctx.db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

/**
 * Stable local identity for "me", used as members.user_id for the self member.
 * A random id until the first sign-in; linkAccount() then replaces it with the account's
 * user id, so all existing callers keep working unchanged.
 */
export function getOrCreateDeviceUserId(ctx: RepoContext): string {
  const existing = getSetting(ctx, DEVICE_USER_ID_KEY);
  if (existing) return existing;

  const id = ctx.newId();
  ctx.db.insert(settings).values({ key: DEVICE_USER_ID_KEY, value: id }).onConflictDoNothing().run();
  return getSetting(ctx, DEVICE_USER_ID_KEY) ?? id;
}