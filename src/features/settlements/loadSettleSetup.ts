import { db } from '@/db/client';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { activeMembersQuery, findSelfMemberId } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { computeBalances } from '@/domain/balances';

export interface SettleMember {
  id: string;
  name: string;
}

export type SettleSetup =
  | { ok: true; me: string; members: SettleMember[]; balances: Map<string, number> }
  | { ok: false; message: string };

/** Members and current balances for the settle-up screen, read once when it opens. */
export function loadSettleSetup(groupId: string): SettleSetup {
  if (!getGroup(db, groupId)) return { ok: false, message: 'This group no longer exists.' };

  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };

  const members = activeMembersQuery(db, groupId)
    .all()
    .map((m) => ({ id: m.id, name: m.id === me ? 'You' : m.displayName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me)); // "You" first

  const ledger = loadGroupLedger(db, groupId);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);

  return { ok: true, me, members, balances };
}