import type { AppDb } from '@/db/context';
import { isGroupLost } from '@/db/repositories/access';
import { activeGroupsQuery } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import type { Group } from '@/db/schema';
import { computeBalances, computePairwiseDebts, type Debt } from '@/domain/balances';
import type { Paise } from '@/domain/money';
import { simplifyDebts } from '@/domain/simplify';

export interface GroupSummary {
  group: Group;
  me: string | null;
  /** My net balance in this group: > 0 I'm owed, < 0 I owe. */
  myBalance: Paise;
  activeMemberCount: number;
  lost: boolean;
  /** Writes allowed: I'm a member and the server hasn't revoked access. */
  canEdit: boolean;
}

export interface MyTransfer {
  groupId: string;
  groupName: string;
  /** My member id in that group (the payer for 'pay', the receiver for 'receive'). */
  meId: string;
  /** 'pay': I pay the counterparty. 'receive': the counterparty pays me. */
  direction: 'pay' | 'receive';
  counterpartyId: string;
  counterpartyName: string;
  amountPaise: Paise;
  canEdit: boolean;
}

export interface Overview {
  groups: GroupSummary[];
  /** Sum of my positive group balances (₹ owed to me across groups). */
  owedToMe: Paise;
  /** Sum of my negative group balances, as a positive number. */
  iOwe: Paise;
  net: Paise;
  /** Payments that involve me, per group, largest first; same suggestions as the group screen. */
  transfers: MyTransfer[];
}

/**
 * Cross-group figures for the Home and Settle tabs.
 *
 * Balances are netted per group, never across groups: Rahul owing me ₹500 in "Goa" and me owing
 * Rahul ₹300 in "Flat" stay two payments, because each group's ledger only settles inside itself.
 * Everything is INR, so the totals are plain integer-paise sums (no rounding involved).
 */
export function loadOverview(db: AppDb, deviceUserId: string): Overview {
  const groups: GroupSummary[] = [];
  const transfers: MyTransfer[] = [];
  let owedToMe = 0;
  let iOwe = 0;

  for (const group of activeGroupsQuery(db).all()) {
    const me = findSelfMemberId(db, group.id, deviceUserId);
    const lost = isGroupLost(db, group.id);
    const members = groupMembersQuery(db, group.id).all();
    const ledger = loadGroupLedger(db, group.id);
    const { balances } = computeBalances(ledger.expenses, ledger.settlements);
    const myBalance = me ? (balances.get(me) ?? 0) : 0;
    const canEdit = me !== null && !lost;

    groups.push({
      group,
      me,
      myBalance,
      activeMemberCount: members.filter((m) => m.deletedAt === null).length,
      lost,
      canEdit,
    });

    if (!me || myBalance === 0) continue;
    if (myBalance > 0) owedToMe += myBalance;
    else iOwe += -myBalance;

    const names = new Map(members.map((m) => [m.id, m.displayName]));
    const debts: Debt[] = group.simplifyDebts
      ? simplifyDebts(balances)
      : computePairwiseDebts(ledger.expenses, ledger.settlements).debts;

    for (const debt of debts) {
      if (debt.fromMemberId !== me && debt.toMemberId !== me) continue;
      const direction = debt.fromMemberId === me ? 'pay' : 'receive';
      const counterpartyId = direction === 'pay' ? debt.toMemberId : debt.fromMemberId;
      transfers.push({
        groupId: group.id,
        groupName: group.name,
        meId: me,
        direction,
        counterpartyId,
        counterpartyName: names.get(counterpartyId) ?? 'Unknown member',
        amountPaise: debt.amountPaise,
        canEdit,
      });
    }
  }

  // Largest first; ties in a stable, readable order so rows don't jump between renders.
  transfers.sort(
    (a, b) =>
      b.amountPaise - a.amountPaise ||
      a.groupName.localeCompare(b.groupName) ||
      a.counterpartyName.localeCompare(b.counterpartyName) ||
      a.counterpartyId.localeCompare(b.counterpartyId),
  );
  return { groups, owedToMe, iOwe, net: owedToMe - iOwe, transfers };
}

/** Tables the overview reads: 'settings' holds the lost-access list. */
export const OVERVIEW_TABLES = [
  'groups',
  'members',
  'expenses',
  'expense_payers',
  'expense_shares',
  'settlements',
  'settings',
] as const;
