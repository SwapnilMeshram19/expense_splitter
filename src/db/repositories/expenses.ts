import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import type { PayerLine } from '@/domain/balances';
import { validateExpense, type ExpenseValidationError } from '@/domain/expenseValidation';
import type { ShareLine } from '@/domain/splits';
import { err, ok, type Result } from '@/lib/result';

import type { AppDb, RepoContext, Tx } from '../context';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  type Expense,
  type ExpenseCategory,
  type StoredSplitInput,
} from '../schema';
import { activeMemberIds } from './members';

export interface ExpenseDraft {
  groupId: string;
  description: string;
  amountPaise: number;
  category?: ExpenseCategory;
  expenseDate: string;
  payers: PayerLine[];
  splitInput: StoredSplitInput;
  /** Member performing the change (recorded in the activity log). */
  actorMemberId: string;
}

export type ExpenseError =
  | ExpenseValidationError
  | { code: 'NOT_FOUND' }
  | { code: 'GROUP_MISMATCH' }
  | { code: 'NOT_A_MEMBER' };

export interface ExpenseDetail {
  expense: Expense;
  payers: PayerLine[];
  shares: ShareLine[];
}

/** Live-queryable expense history of a group, newest first. */
export const groupExpensesQuery = (db: AppDb, groupId: string) =>
  db
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));

/** Expense with its payer/share lines (including soft-deleted expenses). */
export function getExpense(db: AppDb, expenseId: string): ExpenseDetail | null {
  const expense = db.select().from(expenses).where(eq(expenses.id, expenseId)).get();
  if (!expense) return null;

  const payers = db
    .select({ memberId: expensePayers.memberId, amountPaise: expensePayers.amountPaise })
    .from(expensePayers)
    .where(eq(expensePayers.expenseId, expenseId))
    .orderBy(asc(expensePayers.memberId))
    .all();
  const shares = db
    .select({ memberId: expenseShares.memberId, amountPaise: expenseShares.amountPaise })
    .from(expenseShares)
    .where(eq(expenseShares.expenseId, expenseId))
    .orderBy(asc(expenseShares.memberId))
    .all();

  return { expense, payers, shares };
}

type SnapshotSource = Pick<
  Expense,
  'description' | 'amountPaise' | 'category' | 'expenseDate' | 'splitInput'
>;

const snapshot = (e: SnapshotSource, payers: PayerLine[], shares: ShareLine[]) => ({
  description: e.description,
  amountPaise: e.amountPaise,
  category: e.category,
  expenseDate: e.expenseDate,
  splitInput: e.splitInput,
  payers,
  shares,
});

function insertLines(tx: Tx, expenseId: string, payers: PayerLine[], shares: ShareLine[]) {
  tx.insert(expensePayers)
    .values(payers.map((p) => ({ expenseId, memberId: p.memberId, amountPaise: p.amountPaise })))
    .run();
  tx.insert(expenseShares)
    .values(shares.map((s) => ({ expenseId, memberId: s.memberId, amountPaise: s.amountPaise })))
    .run();
}

export function createExpense(
  ctx: RepoContext,
  draft: ExpenseDraft,
): Result<{ expenseId: string }, ExpenseError> {
  const allowed = activeMemberIds(ctx.db, draft.groupId);
  if (!allowed.has(draft.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });

  const valid = validateExpense(draft, allowed);
  if (!valid.ok) return err(valid.error);

  const expenseId = ctx.newId();
  const t = ctx.now();
  const row = {
    description: valid.description,
    amountPaise: draft.amountPaise,
    category: draft.category ?? 'general',
    expenseDate: draft.expenseDate,
    splitInput: draft.splitInput,
  };

  ctx.db.transaction((tx) => {
    tx.insert(expenses)
      .values({
        id: expenseId,
        groupId: draft.groupId,
        createdByMemberId: draft.actorMemberId,
        createdAt: t,
        updatedAt: t,
        ...row,
      })
      .run();
    insertLines(tx, expenseId, valid.payers, valid.shares);
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: draft.groupId,
        entityType: 'expense',
        entityId: expenseId,
        action: 'create',
        actorMemberId: draft.actorMemberId,
        after: snapshot(row, valid.payers, valid.shares),
        createdAt: t,
      })
      .run();
  });

  return ok({ expenseId });
}

export function updateExpense(
  ctx: RepoContext,
  expenseId: string,
  draft: ExpenseDraft,
): Result<void, ExpenseError> {
  const existing = getExpense(ctx.db, expenseId);
  if (!existing || existing.expense.deletedAt !== null) return err({ code: 'NOT_FOUND' });
  if (existing.expense.groupId !== draft.groupId) return err({ code: 'GROUP_MISMATCH' });

  const allowed = activeMemberIds(ctx.db, draft.groupId);
  if (!allowed.has(draft.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });
  // Members who have since left may remain on an expense they were already part of.
  for (const line of [...existing.payers, ...existing.shares]) allowed.add(line.memberId);

  const valid = validateExpense(draft, allowed);
  if (!valid.ok) return err(valid.error);

  const t = ctx.now();
  const row = {
    description: valid.description,
    amountPaise: draft.amountPaise,
    category: draft.category ?? existing.expense.category,
    expenseDate: draft.expenseDate,
    splitInput: draft.splitInput,
  };

  ctx.db.transaction((tx) => {
    // version is intentionally unchanged: it is the base for sync conflict detection.
    tx.update(expenses)
      .set({ ...row, updatedAt: t, dirty: true })
      .where(eq(expenses.id, expenseId))
      .run();
    tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId)).run();
    tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId)).run();
    insertLines(tx, expenseId, valid.payers, valid.shares);
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: draft.groupId,
        entityType: 'expense',
        entityId: expenseId,
        action: 'update',
        actorMemberId: draft.actorMemberId,
        before: snapshot(existing.expense, existing.payers, existing.shares),
        after: snapshot(row, valid.payers, valid.shares),
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}

/** Soft delete (tombstone) so the delete can sync and the history keeps the old values. */
export function deleteExpense(
  ctx: RepoContext,
  expenseId: string,
  actorMemberId: string,
): Result<void, ExpenseError> {
  const existing = getExpense(ctx.db, expenseId);
  if (!existing || existing.expense.deletedAt !== null) return err({ code: 'NOT_FOUND' });
  if (!activeMemberIds(ctx.db, existing.expense.groupId).has(actorMemberId)) {
    return err({ code: 'NOT_A_MEMBER' });
  }

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(expenses)
      .set({ deletedAt: t, updatedAt: t, dirty: true })
      .where(eq(expenses.id, expenseId))
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: existing.expense.groupId,
        entityType: 'expense',
        entityId: expenseId,
        action: 'delete',
        actorMemberId,
        before: snapshot(existing.expense, existing.payers, existing.shares),
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}