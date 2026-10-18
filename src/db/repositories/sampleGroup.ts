import { eq, inArray } from 'drizzle-orm';

import { err, ok, type Result } from '@/lib/result';

import type { RepoContext } from '../context';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  receiptFiles,
  recurringRules,
  settings,
  settlements,
} from '../schema';
import { SAMPLE_GROUP_IDS_KEY, sampleGroupIds } from './sampleIds';

export { isSampleGroup, SAMPLE_GROUP_IDS_KEY, sampleGroupIds } from './sampleIds';

export type RemoveSampleError = { code: 'NOT_SAMPLE' };

/**
 * Deletes one example group and everything in it, from this phone (it was never anywhere else).
 * Returns the ids of receipt photos taken in it, for the caller to delete from storage.
 */
export function removeSampleGroup(ctx: RepoContext, groupId: string): Result<{ receiptIds: string[] }, RemoveSampleError> {
  const ids = sampleGroupIds(ctx.db);
  if (!ids.has(groupId)) return err({ code: 'NOT_SAMPLE' });
  ids.delete(groupId);

  const receiptIds = ctx.db
    .select({ id: receiptFiles.receiptId })
    .from(receiptFiles)
    .where(eq(receiptFiles.groupId, groupId))
    .all()
    .map((r) => r.id);

  ctx.db.transaction((tx) => {
    const groupExpenses = tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId));
    tx.delete(expensePayers).where(inArray(expensePayers.expenseId, groupExpenses)).run();
    tx.delete(expenseShares).where(inArray(expenseShares.expenseId, groupExpenses)).run();
    tx.delete(receiptFiles).where(eq(receiptFiles.groupId, groupId)).run();
    tx.delete(expenses).where(eq(expenses.groupId, groupId)).run();
    tx.delete(settlements).where(eq(settlements.groupId, groupId)).run();
    tx.delete(activityLog).where(eq(activityLog.groupId, groupId)).run();
    tx.delete(recurringRules).where(eq(recurringRules.groupId, groupId)).run();
    tx.delete(members).where(eq(members.groupId, groupId)).run();
    tx.delete(groups).where(eq(groups.id, groupId)).run();
    const value = JSON.stringify([...ids]);
    tx.insert(settings)
      .values({ key: SAMPLE_GROUP_IDS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  });
  return ok({ receiptIds });
}

/**
 * Deletes every example group an older build left on this phone. Runs at startup, before sync;
 * cheap no-op once the list is empty. Returns receipt photo ids for the caller to delete.
 */
export function removeLegacySampleGroups(ctx: RepoContext): string[] {
  const receiptIds: string[] = [];
  for (const groupId of sampleGroupIds(ctx.db)) {
    const result = removeSampleGroup(ctx, groupId);
    if (result.ok) receiptIds.push(...result.value.receiptIds);
  }
  return receiptIds;
}
