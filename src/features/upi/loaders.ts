import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { isGroupLost, LOST_ACCESS_MESSAGE } from '@/db/repositories/access';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId } from '@/db/repositories/members';
import { canEditMemberUpi } from '@/db/repositories/memberUpi';
import { members } from '@/db/schema';
import { getDeviceUserId } from '@/db/session';
import { computeBalances } from '@/domain/balances';
import type { CurrencyCode } from '@/domain/currency';
import { parsePayMethods, type PayMethod } from '@/domain/payMethods';
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

function balancesOf(groupId: string): Map<string, number> {
  const ledger = loadGroupLedger(db, groupId);
  return computeBalances(ledger.expenses, ledger.settlements).balances;
}

// ── Pay screen (you pay someone) ───────────────────────────────────────────

export interface PayPayee {
  id: string;
  name: string;
  /** Only a VPA that passes validation; synced values are untrusted. */
  vpa: string | null;
  storedVpaInvalid: boolean;
  /** Other ways to pay them, valid ones only. */
  methods: PayMethod[];
  canEditVpa: boolean;
  /** Not on the app: their details were typed in by someone in the group. */
  isPlaceholder: boolean;
}

export type PaySetup =
  | { ok: true; me: string; groupName: string; currency: CurrencyCode; payee: PayPayee; myDebtPaise: number }
  | Fail;

export function loadPaySetup(groupId: string, toMemberId: string | undefined): PaySetup {
  const group = getGroup(db, groupId);
  if (!group) return fail('This group no longer exists.');
  if (isGroupLost(db, groupId)) return fail(LOST_ACCESS_MESSAGE);
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return fail('You’re not a member of this group.');
  if (!toMemberId || toMemberId === me) return fail('Choose who to pay.');
  const row = loadMember(groupId, toMemberId);
  if (!row) return fail('This person is no longer in the group.');

  const myBalance = balancesOf(groupId).get(me) ?? 0;

  return {
    ok: true,
    me,
    groupName: group.name,
    currency: group.currency,
    payee: {
      id: row.id,
      name: row.displayName,
      vpa: isValidVpa(row.upiVpa) ? row.upiVpa : null,
      storedVpaInvalid: row.upiVpa !== null && !isValidVpa(row.upiVpa),
      methods: parsePayMethods(row.payMethods),
      canEditVpa: canEditMemberUpi(row, me),
      isPlaceholder: row.userId === null,
    },
    myDebtPaise: Math.max(0, -myBalance),
  };
}

// ── Request screen (someone pays you; you show a QR code) ──────────────────

export type RequestSetup =
  | {
      ok: true;
      me: string;
      myName: string;
      myVpa: string | null;
      myMethods: PayMethod[];
      groupName: string;
      currency: CurrencyCode;
      payer: { id: string; name: string };
      payerDebtPaise: number;
    }
  | Fail;

export function loadRequestSetup(groupId: string, fromMemberId: string | undefined): RequestSetup {
  const group = getGroup(db, groupId);
  if (!group) return fail('This group no longer exists.');
  if (isGroupLost(db, groupId)) return fail(LOST_ACCESS_MESSAGE);
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return fail('You’re not a member of this group.');
  if (!fromMemberId || fromMemberId === me) return fail('Choose who is paying you.');
  const payerRow = loadMember(groupId, fromMemberId);
  if (!payerRow) return fail('This person is no longer in the group.');
  const meRow = loadMember(groupId, me);
  if (!meRow) return fail('You’re not a member of this group.');

  const payerBalance = balancesOf(groupId).get(payerRow.id) ?? 0;

  return {
    ok: true,
    me,
    myName: meRow.displayName,
    myVpa: isValidVpa(meRow.upiVpa) ? meRow.upiVpa : null,
    myMethods: parsePayMethods(meRow.payMethods),
    groupName: group.name,
    currency: group.currency,
    payer: { id: payerRow.id, name: payerRow.displayName },
    payerDebtPaise: Math.max(0, -payerBalance),
  };
}

// ── UPI ID edit screen ─────────────────────────────────────────────────────

export type MemberUpiSetup =
  | {
      ok: true;
      me: string;
      groupName: string;
      member: {
        id: string;
        name: string;
        vpa: string | null;
        methods: PayMethod[];
        isMe: boolean;
        isPlaceholder: boolean;
      };
      canEdit: boolean;
    }
  | Fail;

export function loadMemberUpiSetup(groupId: string, memberId: string | undefined): MemberUpiSetup {
  const group = getGroup(db, groupId);
  if (!group) return fail('This group no longer exists.');
  if (isGroupLost(db, groupId)) return fail(LOST_ACCESS_MESSAGE);
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
      methods: parsePayMethods(row.payMethods),
      isMe: row.id === me,
      isPlaceholder: row.userId === null,
    },
    canEdit: canEditMemberUpi(row, me),
  };
}