import { eq, inArray } from 'drizzle-orm';

import type { RepoContext, Tx } from '@/db/context';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  settings,
  settlements,
} from '@/db/schema';
import { err, ok, type Result } from '@/lib/result';

import { getLostGroupIds, getSyncIssues, SYNC_ISSUES_KEY, SYNC_LOST_GROUPS_KEY } from './engine';
import { getRefetchGroupIds, SYNC_REFETCH_GROUPS_KEY } from './issueActions';

export type ForgetError = { code: 'NOT_LOST' };

function writeSetting(tx: Tx, key: string, value: string): void {
  tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

/**
 * Delete a group this phone has lost access to, on this phone only (nothing is pushed).
 * Also drops its pending sync issues. Refused for groups we can still access: those must be
 * deleted through the normal, synced deleteGroup.
 */
export function forgetGroupLocally(ctx: RepoContext, groupId: string): Result<void, ForgetError> {
  const lost = getLostGroupIds(ctx);
  if (!lost.includes(groupId)) return err({ code: 'NOT_LOST' });

  const db = ctx.db;
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
  const rowIds = new Set<string>([
    groupId,
    ...ids(db.select({ id: members.id }).from(members).where(eq(members.groupId, groupId)).all()),
    ...ids(db.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId)).all()),
    ...ids(db.select({ id: settlements.id }).from(settlements).where(eq(settlements.groupId, groupId)).all()),
    ...ids(db.select({ id: activityLog.id }).from(activityLog).where(eq(activityLog.groupId, groupId)).all()),
  ]);
  const issues = getSyncIssues(ctx).filter((i) => !rowIds.has(i.id));
  const refetch = getRefetchGroupIds(ctx).filter((id) => id !== groupId);

  ctx.db.transaction((tx) => {
    // Children first (subqueries, so no SQLite bound-variable limit for big groups).
    const groupExpenses = tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId));
    tx.delete(expensePayers).where(inArray(expensePayers.expenseId, groupExpenses)).run();
    tx.delete(expenseShares).where(inArray(expenseShares.expenseId, groupExpenses)).run();
    tx.delete(expenses).where(eq(expenses.groupId, groupId)).run();
    tx.delete(settlements).where(eq(settlements.groupId, groupId)).run();
    tx.delete(activityLog).where(eq(activityLog.groupId, groupId)).run();
    tx.delete(members).where(eq(members.groupId, groupId)).run();
    tx.delete(groups).where(eq(groups.id, groupId)).run();

    writeSetting(tx, SYNC_ISSUES_KEY, JSON.stringify(issues));
    writeSetting(tx, SYNC_LOST_GROUPS_KEY, JSON.stringify(lost.filter((id) => id !== groupId)));
    writeSetting(tx, SYNC_REFETCH_GROUPS_KEY, JSON.stringify(refetch));
  });

  return ok(undefined);
}