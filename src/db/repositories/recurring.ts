import { and, eq, isNull } from 'drizzle-orm';

import type { PayerLine } from '@/domain/balances';
import { validateExpense, type ExpenseValidationError } from '@/domain/expenseValidation';
import { normalizeNote } from '@/domain/note';
import {
  dueOccurrences,
  MAX_OCCURRENCES_PER_RUN,
  occurrenceActivityId,
  occurrenceId,
  validateSchedule,
  type Frequency,
  type ScheduleError,
} from '@/domain/recurrence';
import { err, ok, type Result } from '@/lib/result';

import type { AppDb, RepoContext, Tx } from '../context';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  recurringRules,
  type ExpenseCategory,
  type RecurringRule,
  type RuleLine,
  type StoredSplitInput,
} from '../schema';
import { isGroupLost } from './access';
import { resolveCategoryLabel } from './expenses';
import { groupCurrency } from './groups';
import { activeMemberIds } from './members';

export interface RuleDraft {
  groupId: string;
  description: string;
  /** Group currency (recurring bills can't be in another currency). */
  amountPaise: number;
  category?: ExpenseCategory;
  categoryLabel?: string | null;
  note?: string | null;
  payers: PayerLine[];
  splitInput: StoredSplitInput;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  /** IANA zone of this phone (expo-localization), used by the server's daily job. */
  timeZone: string;
  actorMemberId: string;
}

export type RuleError =
  | ExpenseValidationError
  | { code: 'NOT_A_MEMBER' }
  | { code: 'NOT_FOUND' }
  | { code: 'CATEGORY_LABEL_TOO_LONG' }
  | { code: 'NOTE_TOO_LONG' }
  | { code: 'SCHEDULE'; error: ScheduleError }
  /** Frequency or start date changed after an occurrence exists: stop it and start a new one. */
  | { code: 'SCHEDULE_LOCKED' }
  | { code: 'INVALID_TIME_ZONE' };

const TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;

/** Active rules of a group, oldest first. */
export const groupRulesQuery = (db: AppDb, groupId: string) =>
  db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.groupId, groupId), isNull(recurringRules.deletedAt)))
    .orderBy(recurringRules.createdAt);

export const getRule = (db: AppDb, ruleId: string): RecurringRule | null =>
  db.select().from(recurringRules).where(eq(recurringRules.id, ruleId)).get() ?? null;

/** Has any occurrence been created (on this phone or synced here)? Then the schedule is fixed. */
export function ruleHasOccurrences(db: AppDb, ruleId: string): boolean {
  return !!db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.recurringRuleId, ruleId))
    .get();
}

const lines = (rows: readonly PayerLine[]): RuleLine[] =>
  rows.map((l) => ({ memberId: l.memberId, amountPaise: l.amountPaise }));

/** Validate a rule draft the same way as an expense (group currency, members, split, note). */
function checkDraft(
  db: AppDb,
  draft: RuleDraft,
  allowed: Set<string>,
  current: { categoryLabel: string | null } | null,
) {
  const schedule = validateSchedule(draft);
  if (schedule) return err<RuleError>({ code: 'SCHEDULE', error: schedule });
  if (!TZ.test(draft.timeZone)) return err<RuleError>({ code: 'INVALID_TIME_ZONE' });

  const valid = validateExpense(
    {
      description: draft.description,
      amountPaise: draft.amountPaise,
      expenseDate: draft.startDate,
      payers: draft.payers,
      splitInput: draft.splitInput,
      currency: groupCurrency(db, draft.groupId),
    },
    allowed,
  );
  if (!valid.ok) return err<RuleError>(valid.error);

  const category = draft.category ?? 'general';
  const label = resolveCategoryLabel(
    category,
    draft.categoryLabel ?? null,
    current?.categoryLabel ?? null,
  );
  if (!label.ok) return err<RuleError>({ code: 'CATEGORY_LABEL_TOO_LONG' });
  const note = normalizeNote(draft.note ?? null);
  if (!note.ok) return err<RuleError>({ code: 'NOTE_TOO_LONG' });

  return ok({
    description: valid.description,
    amountPaise: draft.amountPaise,
    category,
    categoryLabel: label.label,
    note: note.note,
    splitInput: draft.splitInput,
    payers: lines(valid.payers),
    shares: lines(valid.shares),
    frequency: draft.frequency,
    startDate: draft.startDate,
    endDate: draft.endDate,
    timeZone: draft.timeZone,
  });
}

function logRule(
  db: AppDb | Tx,
  ctx: RepoContext,
  rule: {
    id: string;
    groupId: string;
    description: string;
    frequency: Frequency;
    startDate: string;
  },
  ruleAction: 'create' | 'update' | 'delete',
  actorMemberId: string,
  t: number,
) {
  // Logged on the group (the activity table's entity types are fixed): older builds show it as
  // "made a change", newer ones describe it.
  db.insert(activityLog)
    .values({
      id: ctx.newId(),
      groupId: rule.groupId,
      entityType: 'group',
      entityId: rule.groupId,
      action: 'update',
      actorMemberId,
      after: {
        recurringRule: {
          id: rule.id,
          description: rule.description,
          frequency: rule.frequency,
          startDate: rule.startDate,
        },
        ruleAction,
      },
      createdAt: t,
    })
    .run();
}

export function createRule(
  ctx: RepoContext,
  draft: RuleDraft,
): Result<{ ruleId: string }, RuleError> {
  const allowed = activeMemberIds(ctx.db, draft.groupId);
  if (!allowed.has(draft.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });
  const checked = checkDraft(ctx.db, draft, allowed, null);
  if (!checked.ok) return checked;

  const ruleId = ctx.newId();
  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.insert(recurringRules)
      .values({
        id: ruleId,
        groupId: draft.groupId,
        createdByMemberId: draft.actorMemberId,
        createdAt: t,
        updatedAt: t,
        ...checked.value,
      })
      .run();
    logRule(
      tx,
      ctx,
      { id: ruleId, groupId: draft.groupId, ...checked.value },
      'create',
      draft.actorMemberId,
      t,
    );
  });
  return ok({ ruleId });
}

/**
 * Change a rule. Applies to future occurrences only; ones already created stay as they are (edit
 * them like any expense). The schedule (frequency, start date) is fixed once an occurrence exists:
 * changing it could create a second expense for a period that already has one.
 */
export function updateRule(
  ctx: RepoContext,
  ruleId: string,
  draft: RuleDraft,
): Result<void, RuleError> {
  const rule = getRule(ctx.db, ruleId);
  if (!rule || rule.deletedAt !== null || rule.groupId !== draft.groupId)
    return err({ code: 'NOT_FOUND' });
  const allowed = activeMemberIds(ctx.db, draft.groupId);
  if (!allowed.has(draft.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });

  const scheduleChanged = rule.frequency !== draft.frequency || rule.startDate !== draft.startDate;
  if (scheduleChanged && ruleHasOccurrences(ctx.db, ruleId))
    return err({ code: 'SCHEDULE_LOCKED' });

  const checked = checkDraft(ctx.db, draft, allowed, rule);
  if (!checked.ok) return checked;

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(recurringRules)
      .set({ ...checked.value, timeZone: rule.timeZone, updatedAt: t, dirty: true })
      .where(eq(recurringRules.id, ruleId))
      .run();
    logRule(
      tx,
      ctx,
      { id: ruleId, groupId: rule.groupId, ...checked.value },
      'update',
      draft.actorMemberId,
      t,
    );
  });
  return ok(undefined);
}

/** Stop repeating. Occurrences already created stay. */
export function deleteRule(
  ctx: RepoContext,
  ruleId: string,
  actorMemberId: string,
): Result<void, RuleError> {
  const rule = getRule(ctx.db, ruleId);
  if (!rule || rule.deletedAt !== null) return err({ code: 'NOT_FOUND' });
  if (!activeMemberIds(ctx.db, rule.groupId).has(actorMemberId))
    return err({ code: 'NOT_A_MEMBER' });
  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(recurringRules)
      .set({ deletedAt: t, updatedAt: t, dirty: true })
      .where(eq(recurringRules.id, ruleId))
      .run();
    logRule(tx, ctx, rule, 'delete', actorMemberId, t);
  });
  return ok(undefined);
}

/**
 * Undo a rule created a moment ago whose first expense couldn't be saved. Only a rule that has never
 * synced and has no occurrence is removed (with its history entry); anything else is left alone.
 */
export function discardNewRule(ctx: RepoContext, ruleId: string): void {
  const rule = getRule(ctx.db, ruleId);
  if (!rule || rule.version !== 0 || ruleHasOccurrences(ctx.db, ruleId)) return;
  ctx.db.transaction((tx) => {
    tx.delete(recurringRules).where(eq(recurringRules.id, ruleId)).run();
    const logs = tx
      .select({ id: activityLog.id, after: activityLog.after })
      .from(activityLog)
      .where(and(eq(activityLog.groupId, rule.groupId), eq(activityLog.dirty, true)))
      .all()
      .filter(
        (l) =>
          (l.after as { recurringRule?: { id?: string } } | null)?.recurringRule?.id === ruleId,
      );
    for (const l of logs) tx.delete(activityLog).where(eq(activityLog.id, l.id)).run();
  });
}

/** Why a rule can't create its next occurrence (shown on the rule), or null. */
export function ruleProblem(db: AppDb, rule: RecurringRule): 'MEMBER_LEFT' | null {
  const active = activeMemberIds(db, rule.groupId);
  return [...rule.payers, ...rule.shares].every((l) => active.has(l.memberId))
    ? null
    : 'MEMBER_LEFT';
}

/**
 * Create the occurrences that are due, on this phone. Same ids as the server's daily job, so a
 * phone that's offline on the 1st still shows the rent, and when both create it they agree.
 * Skips groups this phone can't edit, deleted groups, and rules naming someone who has left.
 * `today` is this phone's calendar day ('YYYY-MM-DD').
 */
export function generateDueOccurrences(
  ctx: RepoContext,
  deviceUserId: string,
  today: string,
): number {
  let created = 0;
  const rules = ctx.db
    .select({ rule: recurringRules })
    .from(recurringRules)
    .innerJoin(groups, eq(groups.id, recurringRules.groupId))
    .where(and(isNull(recurringRules.deletedAt), isNull(groups.deletedAt)))
    .all()
    .map((r) => r.rule);

  for (const rule of rules) {
    if (isGroupLost(ctx.db, rule.groupId)) continue;
    const self = ctx.db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.groupId, rule.groupId),
          eq(members.userId, deviceUserId),
          isNull(members.deletedAt),
        ),
      )
      .get();
    if (!self || ruleProblem(ctx.db, rule)) continue;

    const existing = new Set(
      ctx.db
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.recurringRuleId, rule.id))
        .all()
        .map((e) => e.id),
    );
    const missing = dueOccurrences(rule, today)
      .map((date) => ({ date, id: occurrenceId(rule.id, date) }))
      .filter(
        (o) =>
          !existing.has(o.id) &&
          !ctx.db.select({ id: expenses.id }).from(expenses).where(eq(expenses.id, o.id)).get(),
      )
      .slice(0, MAX_OCCURRENCES_PER_RUN);

    for (const { date, id } of missing) {
      const t = ctx.now();
      ctx.db.transaction((tx) => {
        tx.insert(expenses)
          .values({
            id,
            groupId: rule.groupId,
            description: rule.description,
            amountPaise: rule.amountPaise,
            category: rule.category,
            categoryLabel: rule.categoryLabel,
            expenseDate: date,
            splitInput: rule.splitInput,
            note: rule.note,
            recurringRuleId: rule.id,
            occurrenceDate: date,
            createdByMemberId: rule.createdByMemberId,
            createdAt: t,
            updatedAt: t,
          })
          .run();
        tx.insert(expensePayers)
          .values(
            rule.payers.map((l) => ({
              expenseId: id,
              memberId: l.memberId,
              amountPaise: l.amountPaise,
            })),
          )
          .run();
        tx.insert(expenseShares)
          .values(
            rule.shares.map((l) => ({
              expenseId: id,
              memberId: l.memberId,
              amountPaise: l.amountPaise,
            })),
          )
          .run();
        tx.insert(activityLog)
          .values({
            id: occurrenceActivityId(rule.id, date),
            groupId: rule.groupId,
            entityType: 'expense',
            entityId: id,
            action: 'create',
            actorMemberId: null,
            after: {
              description: rule.description,
              amountPaise: rule.amountPaise,
              category: rule.category,
              expenseDate: date,
              payers: rule.payers,
              shares: rule.shares,
              recurringRuleId: rule.id,
              frequency: rule.frequency,
            },
            createdAt: t,
          })
          .onConflictDoNothing()
          .run();
      });
      created++;
    }
  }
  return created;
}

/** A pristine occurrence: created by a rule and not edited since (safe to replace by the server's). */
export const isPristineOccurrence = (e: {
  recurringRuleId: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}): boolean => e.recurringRuleId !== null && e.version === 0 && e.createdAt === e.updatedAt;
