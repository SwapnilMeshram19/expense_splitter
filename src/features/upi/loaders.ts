import { dataStore } from '@/data';
import { balancesOf, findSelfMemberId, memberOf } from '@/data/selectors';
import { canEditPayDetails } from '@/domain/commands';
import type { GroupSnapshot } from '@/domain/model';
import type { CurrencyCode } from '@/domain/currency';
import { parsePayMethods, type PayMethod } from '@/domain/payMethods';
import { isValidVpa } from '@/domain/upi';

type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });


/** The group and my member in it, or why the screen can't open. */
function open(groupId: string): { snapshot: GroupSnapshot; me: string } | Fail {
  const store = dataStore();
  const snapshot = store.group(groupId);
  if (!snapshot) return fail('This group no longer exists.');
  const me = findSelfMemberId(snapshot, store.planningUserId());
  if (!me) return fail('You’re not a member of this group.');
  return { snapshot, me };
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
  const opened = open(groupId);
  if ('ok' in opened) return opened;
  const { snapshot, me } = opened;
  const group = snapshot.group;
  if (!toMemberId || toMemberId === me) return fail('Choose who to pay.');
  const row = memberOf(snapshot, toMemberId);
  if (!row) return fail('This person is no longer in the group.');

  const myBalance = balancesOf(snapshot).get(me) ?? 0;

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
      canEditVpa: canEditPayDetails(row, me),
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
  const opened = open(groupId);
  if ('ok' in opened) return opened;
  const { snapshot, me } = opened;
  const group = snapshot.group;
  if (!fromMemberId || fromMemberId === me) return fail('Choose who is paying you.');
  const payerRow = memberOf(snapshot, fromMemberId);
  if (!payerRow) return fail('This person is no longer in the group.');
  const meRow = memberOf(snapshot, me);
  if (!meRow) return fail('You’re not a member of this group.');

  const payerBalance = balancesOf(snapshot).get(payerRow.id) ?? 0;

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
      /** The version an edit is made on. */
      expectedVersion: number;
    }
  | Fail;

export function loadMemberUpiSetup(groupId: string, memberId: string | undefined): MemberUpiSetup {
  const opened = open(groupId);
  if ('ok' in opened) return opened;
  const { snapshot, me } = opened;
  const group = snapshot.group;
  const row = memberOf(snapshot, memberId);
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
    canEdit: canEditPayDetails(row, me),
    expectedVersion: row.version,
  };
}