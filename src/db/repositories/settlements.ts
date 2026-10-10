import { and, desc, eq, isNull } from 'drizzle-orm';

import { maxAmountMinor } from '@/domain/currency';
import type { Paise } from '@/domain/money';
import { err, ok, type Result } from '@/lib/result';

import type { AppDb, RepoContext } from '../context';
import { activityLog, settlements, type Settlement, type SettlementMethod } from '../schema';
import { groupCurrency } from './groups';
import { activeMemberIds } from './members';

export const MAX_NOTE_LENGTH = 100;

export interface SettlementDraft {
  groupId: string;
  /** Member who paid the money. */
  fromMemberId: string;
  /** Member who received it. */
  toMemberId: string;
  /** Minor units of the group currency. */
  amountPaise: Paise;
  method: SettlementMethod;
  note?: string;
  /** Member recording the payment (may be neither payer nor receiver). */
  actorMemberId: string;
}

export type SettlementError =
  | { code: 'INVALID_AMOUNT' }
  | { code: 'SAME_PERSON' }
  | { code: 'UNKNOWN_MEMBER'; memberId: string }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'NOTE_TOO_LONG'; max: number }
  | { code: 'NOT_FOUND' };

/** Active settlements of a group, newest first. */
export const groupSettlementsQuery = (db: AppDb, groupId: string) =>
  db
    .select()
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)))
    .orderBy(desc(settlements.settledAt));

export function getSettlement(db: AppDb, settlementId: string): Settlement | null {
  return db.select().from(settlements).where(eq(settlements.id, settlementId)).get() ?? null;
}

type SnapshotSource = Pick<
  Settlement,
  'fromMemberId' | 'toMemberId' | 'amountPaise' | 'method' | 'note' | 'settledAt'
>;

const snapshot = (s: SnapshotSource) => ({
  fromMemberId: s.fromMemberId,
  toMemberId: s.toMemberId,
  amountPaise: s.amountPaise,
  method: s.method,
  note: s.note,
  settledAt: s.settledAt,
});

export function recordSettlement(
  ctx: RepoContext,
  draft: SettlementDraft,
): Result<{ settlementId: string }, SettlementError> {
  const allowed = activeMemberIds(ctx.db, draft.groupId);
  if (!allowed.has(draft.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });
  if (draft.fromMemberId === draft.toMemberId) return err({ code: 'SAME_PERSON' });
  for (const memberId of [draft.fromMemberId, draft.toMemberId]) {
    if (!allowed.has(memberId)) return err({ code: 'UNKNOWN_MEMBER', memberId });
  }
  if (
    !Number.isSafeInteger(draft.amountPaise) ||
    draft.amountPaise <= 0 ||
    draft.amountPaise > maxAmountMinor(groupCurrency(ctx.db, draft.groupId))
  ) {
    return err({ code: 'INVALID_AMOUNT' });
  }

  const note = draft.note?.trim().replace(/\s+/g, ' ') || null;
  if (note && note.length > MAX_NOTE_LENGTH) return err({ code: 'NOTE_TOO_LONG', max: MAX_NOTE_LENGTH });

  const settlementId = ctx.newId();
  const t = ctx.now();
  const row = {
    fromMemberId: draft.fromMemberId,
    toMemberId: draft.toMemberId,
    amountPaise: draft.amountPaise,
    method: draft.method,
    note,
    settledAt: t,
  };

  ctx.db.transaction((tx) => {
    tx.insert(settlements)
      .values({
        id: settlementId,
        groupId: draft.groupId,
        createdByMemberId: draft.actorMemberId,
        createdAt: t,
        updatedAt: t,
        ...row,
      })
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: draft.groupId,
        entityType: 'settlement',
        entityId: settlementId,
        action: 'create',
        actorMemberId: draft.actorMemberId,
        after: snapshot(row),
        createdAt: t,
      })
      .run();
  });

  return ok({ settlementId });
}

/** Soft delete (tombstone) so the delete can sync and the history keeps the old values. */
export function deleteSettlement(
  ctx: RepoContext,
  settlementId: string,
  actorMemberId: string,
): Result<void, SettlementError> {
  const existing = getSettlement(ctx.db, settlementId);
  if (!existing || existing.deletedAt !== null) return err({ code: 'NOT_FOUND' });
  if (!activeMemberIds(ctx.db, existing.groupId).has(actorMemberId)) {
    return err({ code: 'NOT_A_MEMBER' });
  }

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(settlements)
      .set({ deletedAt: t, updatedAt: t, dirty: true })
      .where(eq(settlements.id, settlementId))
      .run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: existing.groupId,
        entityType: 'settlement',
        entityId: settlementId,
        action: 'delete',
        actorMemberId,
        before: snapshot(existing),
        createdAt: t,
      })
      .run();
  });

  return ok(undefined);
}