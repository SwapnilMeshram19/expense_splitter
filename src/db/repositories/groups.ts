import { and, desc, eq, isNull } from 'drizzle-orm';

import { err, ok, type Result } from '@/lib/result';

import type { AppDb, RepoContext } from '../context';
import { activityLog, groups, members, type Group } from '../schema';
import { activeMemberIds } from './members';
import { findDuplicateName, normalizeName, validateName, type NameError } from './names';

export interface CreateGroupInput {
  name: string;
  /** Display name of the person creating the group (becomes the self member). */
  selfName: string;
  /** Other people to add as placeholder members. */
  otherMemberNames: string[];
  deviceUserId: string;
}

export type GroupError =
  | { target: 'group'; error: NameError }
  | { target: 'member'; error: NameError };

export type GroupUpdateError = NameError | { code: 'GROUP_NOT_FOUND' } | { code: 'NOT_A_MEMBER' };

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
  if (duplicate) return err({ target: 'member', error: { code: 'DUPLICATE_NAME', name: duplicate } });

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
    tx.insert(groups).values({ id: groupId, name, createdAt: t, updatedAt: t }).run();
    tx.insert(members).values(memberRows).run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId,
        entityType: 'group',
        entityId: groupId,
        action: 'create',
        actorMemberId: selfMemberId,
        after: { name, members: memberNames },
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