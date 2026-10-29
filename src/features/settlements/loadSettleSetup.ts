import { dataStore } from '@/data';
import { activeMembersOf, balancesOf, findSelfMemberId } from '@/data/selectors';
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
  const store = dataStore();
  const snapshot = store.group(groupId);
  if (!snapshot) return { ok: false, message: 'This group no longer exists.' };

  const me = findSelfMemberId(snapshot, store.planningUserId());
  if (!me) return { ok: false, message: 'You’re not a member of this group.' };

  const members = activeMembersOf(snapshot)
    .map((m) => ({ id: m.id, name: m.id === me ? 'You' : m.displayName }))
    .sort((a, b) => Number(b.id === me) - Number(a.id === me)); // "You" first

  return { ok: true, me, members, balances: balancesOf(snapshot), currency: snapshot.group.currency };
}
