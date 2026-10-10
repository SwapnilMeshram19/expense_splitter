import { db } from '@/db/client';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { activeMembersQuery, findSelfMemberId } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { computeBalances } from '@/domain/balances';
import type { CurrencyCode } from '@/domain/currency';

export interface SettleMember {
  id: string;
  name: string;
}

export type SettleSetup =
  | {
      ok: true;
      me: string;
      members: SettleMember[];
      /** Minor units of `currency`. */
      balances: Map<string, number>;
      /** The group's currency: the payment is recorded in it. */
      currency: CurrencyCode;
    }
  | { ok: false; message: string };

/** Members and current balances for the settle-up screen, read once when it opens. */
export function loadSettleSetup(groupId: string): SettleSetup {
  const group = getGroup(db, groupId);
  if (!group) return { ok: false, message: 'This group no longer exists.' };

  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };

  const members = activeMembersQuery(db, groupId)
    .all()
    .map((m) => ({ id: m.id, name: m.id === me ? 'You' : m.displayName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me)); // "You" first

  const ledger = loadGroupLedger(db, groupId);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);

  return { ok: true, me, members, balances, currency: group.currency };
}