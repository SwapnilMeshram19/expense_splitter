import { eq } from 'drizzle-orm';

import { maskVpa, parseVpaInput, type VpaError } from '@/domain/upi';
import { err, ok, type Result } from '@/lib/result';

import type { RepoContext } from '../context';
import { activityLog, members } from '../schema';
import { activeMemberIds } from './members';

export type MemberUpiError =
  | { code: 'MEMBER_NOT_FOUND' }
  | { code: 'NOT_A_MEMBER' }
  | { code: 'NOT_ALLOWED' }
  | VpaError;

/**
 * A claimed member's UPI ID is theirs alone; a placeholder's can be set by anyone in the group.
 * Mirrors private.guard_member_vpa() on the server.
 */
export function canEditMemberUpi(member: { id: string; userId: string | null }, actorMemberId: string): boolean {
  return member.id === actorMemberId || member.userId === null;
}

/** Set or clear (null / blank) a member's UPI ID. Accepts a pasted upi:// link too. */
export function setMemberUpiVpa(
  ctx: RepoContext,
  input: { memberId: string; vpaInput: string | null; actorMemberId: string },
): Result<{ vpa: string | null }, MemberUpiError> {
  const member = ctx.db.select().from(members).where(eq(members.id, input.memberId)).get();
  if (!member || member.deletedAt !== null) return err({ code: 'MEMBER_NOT_FOUND' });
  if (!activeMemberIds(ctx.db, member.groupId).has(input.actorMemberId)) return err({ code: 'NOT_A_MEMBER' });
  if (!canEditMemberUpi(member, input.actorMemberId)) return err({ code: 'NOT_ALLOWED' });

  let vpa: string | null = null;
  if (input.vpaInput !== null && input.vpaInput.trim() !== '') {
    const parsed = parseVpaInput(input.vpaInput);
    if (!parsed.ok) return err(parsed.error);
    vpa = parsed.vpa;
  }
  if (vpa === member.upiVpa) return ok({ vpa });

  const t = ctx.now();
  ctx.db.transaction((tx) => {
    tx.update(members).set({ upiVpa: vpa, updatedAt: t, dirty: true }).where(eq(members.id, member.id)).run();
    tx.insert(activityLog)
      .values({
        id: ctx.newId(),
        groupId: member.groupId,
        entityType: 'member',
        entityId: member.id,
        action: 'update',
        actorMemberId: input.actorMemberId,
        // Masked: the log is append-only and synced; full IDs (often phone numbers) must not live there forever.
        before: { upiVpa: member.upiVpa ? maskVpa(member.upiVpa) : null },
        after: { upiVpa: vpa ? maskVpa(vpa) : null },
        createdAt: t,
      })
      .run();
  });

  return ok({ vpa });
}