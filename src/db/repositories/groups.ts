import { and, desc, eq, isNull } from 'drizzle-orm';

import { err, ok, type Result } from '@/lib/result';

import type { AppDb, RepoContext } from '../context';
import { activityLog, groups, members, type Group } from '../schema';
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