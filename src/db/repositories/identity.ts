import { eq } from 'drizzle-orm';

import { err, ok, type Result } from '@/lib/result';

import type { RepoContext } from '../context';
import { members, settings } from '../schema';
import { DEVICE_USER_ID_KEY, getOrCreateDeviceUserId, getSetting } from './profile';

/** The account this phone's local data belongs to. Set on first sign-in, kept on sign-out. */
export const ACCOUNT_USER_ID_KEY = 'account_user_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkAccountError = { code: 'INVALID_USER_ID' } | { code: 'OTHER_ACCOUNT_LINKED' };

export interface LinkAccountResult {
  /** Self members moved from the device id to the account id. */
  relinkedMembers: number;
  /** Groups that already contained the account: the stale device-id row became a placeholder. */
  detachedGroupIds: string[];
}

export function getLinkedAccountId(ctx: RepoContext): string | null {
  return getSetting(ctx, ACCOUNT_USER_ID_KEY);
}

/**
 * Bind this phone's local data to a signed-in account, atomically.
 *
 * - First sign-in: every member row with the device id (including in deleted groups, so
 *   tombstones sync with the right owner) gets the account id and is marked dirty.
 * - Same account again: no-op.
 * - A different account: refused, nothing changes. Prevents one person adopting another's
 *   groups and balances on a shared or handed-down phone.
 */
export function linkAccount(
  ctx: RepoContext,
  userId: string,
): Result<LinkAccountResult, LinkAccountError> {
  if (!UUID_RE.test(userId)) return err({ code: 'INVALID_USER_ID' });
  const accountId = userId.toLowerCase();

  const linked = getLinkedAccountId(ctx);
  if (linked === accountId) return ok({ relinkedMembers: 0, detachedGroupIds: [] });
  if (linked !== null) return err({ code: 'OTHER_ACCOUNT_LINKED' });

  const localId = getOrCreateDeviceUserId(ctx);
  const selfRows = ctx.db
    .select({ id: members.id, groupId: members.groupId })
    .from(members)
    .where(eq(members.userId, localId))
    .all();
  const groupsWithAccount = new Set(
    ctx.db
      .select({ groupId: members.groupId })
      .from(members)
      .where(eq(members.userId, accountId))
      .all()
      .map((row) => row.groupId),
  );

  const toRelink = selfRows.filter((row) => !groupsWithAccount.has(row.groupId));
  const toDetach = selfRows.filter((row) => groupsWithAccount.has(row.groupId));
  const t = ctx.now();

  ctx.db.transaction((tx) => {
    for (const row of toRelink) {
      tx.update(members)
        .set({ userId: accountId, updatedAt: t, dirty: true })
        .where(eq(members.id, row.id))
        .run();
    }
    // A device id must never reach the server (members.user_id references real users).
    for (const row of toDetach) {
      tx.update(members)
        .set({ userId: null, updatedAt: t, dirty: true })
        .where(eq(members.id, row.id))
        .run();
    }
    for (const key of [DEVICE_USER_ID_KEY, ACCOUNT_USER_ID_KEY]) {
      tx.insert(settings)
        .values({ key, value: accountId })
        .onConflictDoUpdate({ target: settings.key, set: { value: accountId } })
        .run();
    }
  });

  return ok({
    relinkedMembers: toRelink.length,
    detachedGroupIds: [...new Set(toDetach.map((row) => row.groupId))],
  });
}