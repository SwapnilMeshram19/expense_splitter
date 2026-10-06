import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId } from '@/db/repositories/members';
import { canEditMemberUpi } from '@/db/repositories/memberUpi';
import { members } from '@/db/schema';
import { getDeviceUserId } from '@/db/session';
import { computeBalances } from '@/domain/balances';
import { isValidVpa } from '@/domain/upi';

type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });

function loadMember(groupId: string, memberId: string | undefined) {
  if (!memberId) return null;
  const row = db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.groupId, groupId)))
    .get();
  return row && row.deletedAt === null ? row : null;
}

// ── Pay screen ─────────────────────────────────────────────────────────────

export interface PayPayee {
  id: string;
  name: string;
  /** Only a VPA that passes validation; synced values are untrusted. */
  vpa: string | null;
  storedVpaInvalid: boolean;
  canEditVpa: boolean;
}

export type PaySetup =
  | { ok: true; me: string; groupName: string; payee: PayPayee; myDebtPaise: number }
  | Fail;

export function loadPaySetup(groupId: string, toMemberId: string | undefined): PaySetup {
  const group = getGroup(db, groupId);
  if (!group) return fail('This group no longer exists.');
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return fail('You’re not a member of this group.');
  if (!toMemberId || toMemberId === me) return fail('Choose who to pay.');
  const row = loadMember(groupId, toMemberId);
  if (!row) return fail('This person is no longer in the group.');

  const ledger = loadGroupLedger(db, groupId);
  const myBalance = computeBalances(ledger.expenses, ledger.settlements).balances.get(me) ?? 0;

  return {
    ok: true,
    me,
    groupName: group.name,
    payee: {
      id: row.id,
      name: row.displayName,
      vpa: isValidVpa(row.upiVpa) ? row.upiVpa : null,
      storedVpaInvalid: row.upiVpa !== null && !isValidVpa(row.upiVpa),
      canEditVpa: canEditMemberUpi(row, me),
    },
    myDebtPaise: Math.max(0, -myBalance),
  };
}

// ── UPI ID edit screen ─────────────────────────────────────────────────────

export type MemberUpiSetup =
  | {
      ok: true;
      me: string;
      groupName: string;
      member: { id: string; name: string; vpa: string | null; isMe: boolean; isPlaceholder: boolean };
      canEdit: boolean;
    }
  | Fail;

export function loadMemberUpiSetup(groupId: string, memberId: string | undefined): MemberUpiSetup {
  const group = getGroup(db, groupId);
  if (!group) return fail('This group no longer exists.');
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return fail('You’re not a member of this group.');
  const row = loadMember(groupId, memberId);
  if (!row) return fail('This person is no longer in the group.');

  return {
    ok: true,
    me,
    groupName: group.name,
    member: {
      id: row.id,
      name: row.displayName,
      vpa: row.upiVpa,
      isMe: row.id === me,
      isPlaceholder: row.userId === null,
    },
    canEdit: canEditMemberUpi(row, me),
  };
}