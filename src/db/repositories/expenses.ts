import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import type { PayerLine } from '@/domain/balances';
import { categoryLabelKey, normalizeCategoryLabel } from '@/domain/categoryLabel';
import { validateExpense, type ExpenseValidationError } from '@/domain/expenseValidation';
import type { ForeignAmount } from '@/domain/fx';
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
import { groupCurrency } from './groups';
import { activeMemberIds } from './members';

export interface ExpenseDraft {
  groupId: string;
  description: string;
  /** Total in the group currency (for a foreign bill: the converted total, checked on save). */
  amountPaise: number;
  category?: ExpenseCategory;
  /** Custom category name; used only with category 'other'. Undefined on update keeps the old one. */
  categoryLabel?: string | null;
  expenseDate: string;
  /** In the bill's currency when `foreign` is set, else in the group currency. */
  payers: PayerLine[];
  /** In the bill's currency when `foreign` is set, else in the group currency. */
  splitInput: StoredSplitInput;
  /** Set for a bill in another currency, with the rate locked for this expense. */
  foreign?: ForeignAmount | null;
  /** Member performing the change (recorded in the activity log). */
  actorMemberId: string;
}

export type ExpenseError =
  | ExpenseValidationError
  | { code: 'CATEGORY_LABEL_TOO_LONG' }
  | { code: 'NOT_FOUND' }
  | { code: 'GROUP_MISMATCH' }
  | { code: 'NOT_A_MEMBER' };

export interface ExpenseDetail {
  expense: Expense;
  /** Group currency. */
  payers: PayerLine[];
  /** Group currency. */
  shares: ShareLine[];
  /** Foreign bills: who paid in the bill's currency; null otherwise. */
  originalPayers: PayerLine[] | null;
}

/** The foreign-bill part of a stored expense, or null for a group-currency expense. */
export function expenseForeign(
  e: Pick<Expense, 'originalCurrency' | 'originalAmountMinor' | 'fxRate'>,
): ForeignAmount | null {
  return e.originalCurrency && e.originalAmountMinor !== null && e.fxRate
    ? { currency: e.originalCurrency, amountMinor: e.originalAmountMinor, rate: e.fxRate }
    : null;
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

  const payerRows = db
    .select({
      memberId: expensePayers.memberId,
      amountPaise: expensePayers.amountPaise,
      originalAmountMinor: expensePayers.originalAmountMinor,
    })
    .from(expensePayers)
    .where(eq(expensePayers.expenseId, expenseId))
    .orderBy(asc(expensePayers.memberId))
    .all();
  const payers = payerRows.map((p) => ({ memberId: p.memberId, amountPaise: p.amountPaise }));
  const foreign = expenseForeign(expense);
  // A single payer paid the whole bill even if the original amount wasn't recorded per line.
  const originalPayers = foreign
    ? payerRows.map((p) => ({
        memberId: p.memberId,
        amountPaise: p.originalAmountMinor ?? (payerRows.length === 1 ? foreign.amountMinor : 0),
      }))
    : null;
  const shares = db
    .select({ memberId: expenseShares.memberId, amountPaise: expenseShares.amountPaise })
    .from(expenseShares)
    .where(eq(expenseShares.expenseId, expenseId))
    .orderBy(asc(expenseShares.memberId))
    .all();

  return { expense, payers, shares, originalPayers };
}

type SnapshotSource = Pick<
  Expense,
  | 'description'
  | 'amountPaise'
  | 'category'
  | 'categoryLabel'
  | 'expenseDate'
  | 'splitInput'
  | 'originalCurrency'
  | 'originalAmountMinor'
  | 'fxRate'
>;

const snapshot = (e: SnapshotSource, payers: PayerLine[], shares: ShareLine[]) => {
  const foreign = expenseForeign(e);
  return {
    description: e.description,
    amountPaise: e.amountPaise,
    category: e.category,
    categoryLabel: e.categoryLabel,
    expenseDate: e.expenseDate,
    splitInput: e.splitInput,
    // Only for foreign bills, so group-currency history entries keep their old shape.
    ...(foreign ? { foreign } : {}),
    payers,
    shares,
  };
};

/** Columns for the foreign-bill part: all set, or all null. */
const foreignColumns = (foreign: ForeignAmount | null | undefined) => ({
  originalCurrency: foreign?.currency ?? null,
  originalAmountMinor: foreign?.amountMinor ?? null,
  fxRate: foreign?.rate ?? null,
});

/**
 * The label to store: only with 'other', normalised. `requested` undefined means "unchanged"
 * (keep `current`), null or '' means "plain Other".
 */
function resolveCategoryLabel(
  category: ExpenseCategory,
  requested: string | null | undefined,
  current: string | null,
): { ok: true; label: string | null } | { ok: false } {
  if (category !== 'other') return { ok: true, label: null };
  if (requested === undefined) return { ok: true, label: current };
  const normalized = normalizeCategoryLabel(requested);
  return normalized.ok ? { ok: true, label: normalized.label } : { ok: false };
}

/**
 * Custom category names used in a group, most used first (case-insensitive, latest spelling
 * wins), for suggestions in the expense form.
 */
export function groupCategoryLabels(db: AppDb, groupId: string, limit = 8): string[] {
  const rows = db
    .select({ label: expenses.categoryLabel })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
        eq(expenses.category, 'other'),
        isNotNull(expenses.categoryLabel),
      ),
    )
    .orderBy(desc(expenses.updatedAt))
    .all();

  const counts = new Map<string, { label: string; count: number }>();
  for (const { label } of rows) {
    if (!label) continue;
    const key = categoryLabelKey(label);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { label, count: 1 }); // first seen = most recently updated spelling
  }
  // Stable sort: equal counts keep most-recent-first order.
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => e.label);
}

/** Foreign currencies used for bills in a group, most recently updated first. */
export function groupBillCurrencies(db: AppDb, groupId: string, limit = 4): string[] {
  const rows = db
    .select({ currency: expenses.originalCurrency })
    .from(expenses)
    .where(
      and(
        eq(expenses.groupId, groupId),
        isNull(expenses.deletedAt),
        isNotNull(expenses.originalCurrency),
      ),
    )
    .orderBy(desc(expenses.updatedAt))
    .all();
  return [...new Set(rows.map((r) => r.currency).filter((c): c is string => !!c))].slice(0, limit);
}

function insertLines(
  tx: Tx,
  expenseId: string,
  payers: PayerLine[],
  shares: ShareLine[],
  originalPayers: PayerLine[] | null,
) {
  const original = new Map(originalPayers?.map((p) => [p.memberId, p.amountPaise]));
  tx.insert(expensePayers)
    .values(
      payers.map((p) => ({
        expenseId,
        memberId: p.memberId,
        amountPaise: p.amountPaise,
        originalAmountMinor: original.get(p.memberId) ?? null,
      })),
    )
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

  const currency = groupCurrency(ctx.db, draft.groupId);
  const valid = validateExpense({ ...draft, currency }, allowed);
  if (!valid.ok) return err(valid.error);

  const category = draft.category ?? 'general';
  const label = resolveCategoryLabel(category, draft.categoryLabel ?? null, null);
  if (!label.ok) return err({ code: 'CATEGORY_LABEL_TOO_LONG' });

  const expenseId = ctx.newId();
  const t = ctx.now();
  const row = {
    description: valid.description,
    amountPaise: draft.amountPaise,
    category,
    categoryLabel: label.label,
    expenseDate: draft.expenseDate,
    splitInput: draft.splitInput,
    ...foreignColumns(draft.foreign),
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
    insertLines(tx, expenseId, valid.payers, valid.shares, valid.originalPayers);
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

  const currency = groupCurrency(ctx.db, draft.groupId);
  const valid = validateExpense({ ...draft, currency }, allowed);
  if (!valid.ok) return err(valid.error);

  const category = draft.category ?? existing.expense.category;
  const label = resolveCategoryLabel(category, draft.categoryLabel, existing.expense.categoryLabel);
  if (!label.ok) return err({ code: 'CATEGORY_LABEL_TOO_LONG' });

  const t = ctx.now();
  const row = {
    description: valid.description,
    amountPaise: draft.amountPaise,
    category,
    categoryLabel: label.label,
    expenseDate: draft.expenseDate,
    splitInput: draft.splitInput,
    ...foreignColumns(draft.foreign),
  };

  ctx.db.transaction((tx) => {
    // version is intentionally unchanged: it is the base for sync conflict detection.
    tx.update(expenses)
      .set({ ...row, updatedAt: t, dirty: true })
      .where(eq(expenses.id, expenseId))
      .run();
    tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId)).run();
    tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId)).run();
    insertLines(tx, expenseId, valid.payers, valid.shares, valid.originalPayers);
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