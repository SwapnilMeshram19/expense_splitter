import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import { computeBalances } from '@/domain/balances';
import { DEFAULT_CURRENCY, isSupportedCurrency, type CurrencyCode } from '@/domain/currency';
import { err, ok, type Result } from '@/lib/result';

import type { AppDb, RepoContext } from '../context';
import { activityLog, expenses, groups, members, recurringRules, settlements, type Group } from '../schema';
import { loadGroupLedger } from './ledger';
import { activeMemberIds } from './members';
import { findDuplicateName, normalizeName, validateName, type NameError } from './names';

export interface CreateGroupInput {
  name: string;
  /** Display name of the person creating the group (becomes the self member). */
  selfName: string;
  /** Other people to add as placeholder members. */
  otherMemberNames: string[];
  deviceUserId: string;
  /** ISO 4217 code for every amount in the group. Default INR. */
  currency?: CurrencyCode;
}

export type GroupError =
  | { target: 'group'; error: NameError }
  | { target: 'member'; error: NameError }
  | { target: 'currency'; error: { code: 'UNKNOWN_CURRENCY' } };

export type GroupCurrencyError =
  | { code: 'GROUP_NOT_FOUND' }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'UNKNOWN_CURRENCY' }
  | { code: 'CURRENCY_LOCKED' };

export type GroupUpdateError = NameError | { code: 'GROUP_NOT_FOUND' } | { code: 'NOT_A_MEMBER' };

export type GroupDeleteError =
  | { code: 'GROUP_NOT_FOUND' }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'UNSETTLED_BALANCES'; count: number };

/** Live-queryable list of active groups, most recently updated first. */
export const activeGroupsQuery = (db: AppDb) =>
  db.select().from(groups).where(isNull(groups.deletedAt)).orderBy(desc(groups.updatedAt));

export function getGroup(db: AppDb, groupId: string): Group | null {
  return (
    db
      .select()
      .from(groups)
      .where(and(eq(groups.id, groupId), isNull(groups.deletedAt)))
      .get() ?? null
  );
}

/** The group's currency (INR for a group that no longer exists locally). */
export function groupCurrency(db: AppDb, groupId: string): CurrencyCode {
  return (
    db.select({ currency: groups.currency }).from(groups).where(eq(groups.id, groupId)).get()
      ?.currency ?? DEFAULT_CURRENCY
  );
}

/**
 * True once the group has any expense, payment or recurring rule, including deleted ones: a deleted
 * expense can be restored, and its amounts are in the currency it was recorded in. Same rule as
 * the server.
 */
export function isCurrencyLocked(db: AppDb, groupId: string): boolean {
  const expense = db
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, groupId))
    .get();
  if (expense) return true;
  if (db.select({ id: recurringRules.id }).from(recurringRules).where(eq(recurringRules.groupId, groupId)).get()) {
    return true;
  }
  return !!db
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .get();
}

/** Create a group with the self member and placeholders, atomically. */
export function createGroup(
  ctx: RepoContext,
  input: CreateGroupInput,
): Result<{ groupId: string; selfMemberId: string }, GroupError> {
  const name = normalizeName(input.name);
  const groupNameError = validateName(name);
  if (groupNameError) return err({ target: 'group', error: groupNameError });

  const memberNames = [input.selfName, ...input.otherMemberNames].map(normalizeName);
  for (const memberName of memberNames) {
    const memberNameError = validateName(memberName);
    if (memberNameError) return err({ target: 'member', error: memberNameError });
  }
  const duplicate = findDuplicateName(memberNames);
  if (duplicate)
    return err({ target: 'member', error: { code: 'DUPLICATE_NAME', name: duplicate } });

  const currency = input.currency ?? DEFAULT_CURRENCY;
  if (!isSupportedCurrency(currency))
    return err({ target: 'currency', error: { code: 'UNKNOWN_CURRENCY' } });

  const groupId = ctx.newId();
  const t = ctx.now();
  const memberRows = memberNames.map((displayName, index) => ({
    id: ctx.newId(),
    groupId,
    displayName,
    userId: index === 0 ? input.deviceUserId : null,
    createdAt: t,
    updatedAt: t,
  }));
  const selfMemberId = memberRows[0]!.id;

  ctx.db.transaction((tx) => {
    tx.insert(groups).values({ id: groupId, name, currency, createdAt: t, updatedAt: t }).run();
    tx.insert(members).values(memberRows).run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId,
        entityType: 'group',
        entityId: groupId,
        action: 'create',
        actorMemberId: selfMemberId,
        after: { name, members: memberNames, currency },
        createdAt: t,
      })
      .run();
  });

  return ok({ groupId, selfMemberId });
}

function checkAccess(ctx: RepoContext, groupId: string, actorMemberId: string): Group | GroupUpdateError {
  const group = getGroup(ctx.db, groupId);
  if (!group) return { code: 'GROUP_NOT_FOUND' };
  if (!activeMemberIds(ctx.db, groupId).has(actorMemberId)) return { code: 'NOT_A_MEMBER' };
  return group;
}

const isError = (value: Group | GroupUpdateError): value is GroupUpdateError => 'code' in value;

export function renameGroup(
  ctx: RepoContext,
  input: { groupId: string; name: string; actorMemberId: string },
): Result<void, GroupUpdateError> {
  const group = checkAccess(ctx, input.groupId, input.actorMemberId);
  if (isError(group)) return err(group);

  const name = normalizeName(input.name);
  const nameError = validateName(name);
  if (nameError) return err(nameError);
  if (name === group.name) return ok(undefined);

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(groups).set({ name, updatedAt: t, dirty: true }).where(eq(groups.id, group.id)).run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: group.id,
        entityType: 'group',
        entityId: group.id,
        action: 'update',
        actorMemberId: input.actorMemberId,
        before: { name: group.name },
        after: { name },
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}

/** Presentation-only switch: balances are identical either way, only the suggested payments change. */
export function setSimplifyDebts(
  ctx: RepoContext,
  input: { groupId: string; simplifyDebts: boolean; actorMemberId: string },
): Result<void, GroupUpdateError> {
  const group = checkAccess(ctx, input.groupId, input.actorMemberId);
  if (isError(group)) return err(group);
  if (group.simplifyDebts === input.simplifyDebts) return ok(undefined);

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(groups)
      .set({ simplifyDebts: input.simplifyDebts, updatedAt: t, dirty: true })
      .where(eq(groups.id, group.id))
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: group.id,
        entityType: 'group',
        entityId: group.id,
        action: 'update',
        actorMemberId: input.actorMemberId,
        before: { simplifyDebts: group.simplifyDebts },
        after: { simplifyDebts: input.simplifyDebts },
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}

/**
 * Change the group's currency. Only while it has no expenses or payments: amounts are never
 * re-denominated. A mistaken currency on a group with data means starting a new group.
 */
export function setGroupCurrency(
  ctx: RepoContext,
  input: { groupId: string; currency: CurrencyCode; actorMemberId: string },
): Result<void, GroupCurrencyError> {
  const group = checkAccess(ctx, input.groupId, input.actorMemberId);
  // checkAccess only reports GROUP_NOT_FOUND / NOT_A_MEMBER.
  if (isError(group))
    return err(group as Extract<GroupCurrencyError, { code: 'GROUP_NOT_FOUND' | 'NOT_A_MEMBER' }>);
  if (!isSupportedCurrency(input.currency)) return err({ code: 'UNKNOWN_CURRENCY' });
  if (group.currency === input.currency) return ok(undefined);
  if (isCurrencyLocked(ctx.db, group.id)) return err({ code: 'CURRENCY_LOCKED' });

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(groups)
      .set({ currency: input.currency, updatedAt: t, dirty: true })
      .where(eq(groups.id, group.id))
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: group.id,
        entityType: 'group',
        entityId: group.id,
        action: 'update',
        actorMemberId: input.actorMemberId,
        before: { currency: group.currency },
        after: { currency: input.currency },
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}

/**
 * Soft-delete a group. Only allowed when everyone is settled up, so no money disappears.
 *
 * actorMemberId = null covers local leftovers with no "you" in them: allowed only when no
 * member of the group is linked to an account (placeholders only). Phase 3 replaces this
 * with server-side permission rules for shared groups.
 */
export function deleteGroup(
  ctx: RepoContext,
  input: { groupId: string; actorMemberId: string | null },
): Result<void, GroupDeleteError> {
  const group = getGroup(ctx.db, input.groupId);
  if (!group) return err({ code: 'GROUP_NOT_FOUND' });

  if (input.actorMemberId !== null) {
    if (!activeMemberIds(ctx.db, group.id).has(input.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });
  } else {
    const linked = ctx.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.groupId, group.id), isNotNull(members.userId)))
      .get();
    if (linked) return err({ code: 'NOT_A_MEMBER' });
  }

  const ledger = loadGroupLedger(ctx.db, group.id);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);
  const unsettled = [...balances.values()].filter((b) => b !== 0).length;
  if (unsettled > 0) return err({ code: 'UNSETTLED_BALANCES', count: unsettled });

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(groups)
      .set({ deletedAt: t, updatedAt: t, dirty: true })
      .where(eq(groups.id, group.id))
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: group.id,
        entityType: 'group',
        entityId: group.id,
        action: 'delete',
        actorMemberId: input.actorMemberId,
        before: { name: group.name },
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}