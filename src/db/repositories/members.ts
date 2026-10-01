import { and, asc, eq, isNull } from 'drizzle-orm';

import { err, ok, type Result } from '@/lib/result';

import type { AppDb, RepoContext } from '../context';
import { activityLog, groups, members } from '../schema';
import { findDuplicateName, normalizeName, validateName, type NameError } from './names';

export type MemberError =
  | NameError
  | { code: 'GROUP_NOT_FOUND' }
  | { code: 'MEMBER_NOT_FOUND' }
  | { code: 'NOT_A_MEMBER' };

/** Live-queryable active members of a group, in the order they were added. */
export const activeMembersQuery = (db: AppDb, groupId: string) =>
  db
    .select()
    .from(members)
    .where(and(eq(members.groupId, groupId), isNull(members.deletedAt)))
    .orderBy(asc(members.createdAt), asc(members.id));

/** All members including those who left, so old expenses can still show their names. */
export const groupMembersQuery = (db: AppDb, groupId: string) =>
  db
    .select()
    .from(members)
    .where(eq(members.groupId, groupId))
    .orderBy(asc(members.createdAt), asc(members.id));

export function activeMemberIds(db: AppDb, groupId: string): Set<string> {
  return new Set(
    activeMembersQuery(db, groupId)
      .all()
      .map((m) => m.id),
  );
}

/** The member representing this device's user in a group, if any. */
export function findSelfMemberId(db: AppDb, groupId: string, deviceUserId: string): string | null {
  return (
    db
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.groupId, groupId),
          eq(members.userId, deviceUserId),
          isNull(members.deletedAt),
        ),
      )
      .get()?.id ?? null
  );
}

export function addMember(
  ctx: RepoContext,
  input: { groupId: string; displayName: string; actorMemberId: string },
): Result<{ memberId: string }, MemberError> {
  const group = ctx.db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, input.groupId), isNull(groups.deletedAt)))
    .get();
  if (!group) return err({ code: 'GROUP_NOT_FOUND' });

  const existing = activeMembersQuery(ctx.db, input.groupId).all();
  if (!existing.some((m) => m.id === input.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });

  const displayName = normalizeName(input.displayName);
  const nameError = validateName(displayName);
  if (nameError) return err(nameError);
  if (findDuplicateName([...existing.map((m) => m.displayName), displayName])) {
    return err({ code: 'DUPLICATE_NAME', name: displayName });
  }

  const memberId = ctx.newId();
  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.insert(members)
      .values({ id: memberId, groupId: input.groupId, displayName, createdAt: t, updatedAt: t })
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: input.groupId,
        entityType: 'member',
        entityId: memberId,
        action: 'create',
        actorMemberId: input.actorMemberId,
        after: { displayName },
        createdAt: t,
      })
      .run();
  });

  return ok({ memberId });
}

export function renameMember(
  ctx: RepoContext,
  input: { memberId: string; displayName: string; actorMemberId: string },
): Result<void, MemberError> {
  const member = ctx.db
    .select()
    .from(members)
    .where(and(eq(members.id, input.memberId), isNull(members.deletedAt)))
    .get();
  if (!member) return err({ code: 'MEMBER_NOT_FOUND' });

  const others = activeMembersQuery(ctx.db, member.groupId).all();
  if (!others.some((m) => m.id === input.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });

  const displayName = normalizeName(input.displayName);
  const nameError = validateName(displayName);
  if (nameError) return err(nameError);
  const otherNames = others.filter((m) => m.id !== member.id).map((m) => m.displayName);
  if (findDuplicateName([...otherNames, displayName])) {
    return err({ code: 'DUPLICATE_NAME', name: displayName });
  }

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(members)
      .set({ displayName, updatedAt: t, dirty: true })
      .where(eq(members.id, member.id))
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: member.groupId,
        entityType: 'member',
        entityId: member.id,
        action: 'update',
        actorMemberId: input.actorMemberId,
        before: { displayName: member.displayName },
        after: { displayName },
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}