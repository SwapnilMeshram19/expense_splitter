import type { AppDb } from '@/db/context';
import { isGroupLost } from '@/db/repositories/access';
import { activeGroupsQuery } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import type { Group } from '@/db/schema';
import { computeBalances, computePairwiseDebts, type Debt } from '@/domain/balances';
import { DEFAULT_CURRENCY, type CurrencyCode } from '@/domain/currency';
import type { Paise } from '@/domain/money';
import { simplifyDebts } from '@/domain/simplify';

export interface GroupSummary {
  group: Group;
  me: string | null;
  /** My net balance in this group, minor units of group.currency: > 0 I'm owed, < 0 I owe. */
  myBalance: Paise;
  activeMemberCount: number;
  lost: boolean;
  /** Writes allowed: I'm a member and the server hasn't revoked access. */
  canEdit: boolean;
}

export interface MyTransfer {
  groupId: string;
  groupName: string;
  /** The group's currency; amountPaise is in its minor units. */
  currency: CurrencyCode;
  /** My member id in that group (the payer for 'pay', the receiver for 'receive'). */
  meId: string;
  /** 'pay': I pay the counterparty. 'receive': the counterparty pays me. */
  direction: 'pay' | 'receive';
  counterpartyId: string;
  counterpartyName: string;
  amountPaise: Paise;
  canEdit: boolean;
}

/** My totals in one currency, summed over the groups that use it. */
export interface CurrencyTotal {
  currency: CurrencyCode;
  /** Sum of my positive group balances. */
  owedToMe: Paise;
  /** Sum of my negative group balances, as a positive number. */
  iOwe: Paise;
  net: Paise;
}

export interface Overview {
  groups: GroupSummary[];
  /**
   * One entry per currency I have a non-zero balance in: INR first, then the rest by code.
   * Empty when I'm settled up everywhere. Never converted between currencies (see loadOverview).
   */
  totals: CurrencyTotal[];
  /** Payments that involve me, per group; INR first, then by currency, largest first within one. */
  transfers: MyTransfer[];
}

/** INR first (the home currency), then alphabetical. */
export const compareCurrencies = (a: CurrencyCode, b: CurrencyCode): number =>
  a === b ? 0 : a === DEFAULT_CURRENCY ? -1 : b === DEFAULT_CURRENCY ? 1 : a < b ? -1 : 1;

/**
 * Cross-group figures for the Home and Settle tabs.
 *
 * Balances are netted per group, never across groups: Rahul owing me ₹500 in "Goa" and me owing
 * Rahul ₹300 in "Flat" stay two payments, because each group's ledger only settles inside itself.
 *
 * Totals are kept per currency and never converted: "₹1,200 + $45" is exact, while a single
 * converted figure would move every day with the rate and match nothing anyone actually pays.
 * Within one currency the totals are plain integer sums (no rounding involved).
 */
export function loadOverview(db: AppDb, deviceUserId: string): Overview {
  const groups: GroupSummary[] = [];
  const transfers: MyTransfer[] = [];
  const totals = new Map<CurrencyCode, CurrencyTotal>();

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
    const total = totals.get(group.currency) ?? {
      currency: group.currency,
      owedToMe: 0,
      iOwe: 0,
      net: 0,
    };
    if (myBalance > 0) total.owedToMe += myBalance;
    else total.iOwe += -myBalance;
    total.net = total.owedToMe - total.iOwe;
    totals.set(group.currency, total);

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
        currency: group.currency,
        meId: me,
        direction,
        counterpartyId,
        counterpartyName: names.get(counterpartyId) ?? 'Unknown member',
        amountPaise: debt.amountPaise,
        canEdit,
      });
    }
  }

  // Amounts only compare within a currency. Ties in a stable, readable order so rows don't jump.
  transfers.sort(
    (a, b) =>
      compareCurrencies(a.currency, b.currency) ||
      b.amountPaise - a.amountPaise ||
      a.groupName.localeCompare(b.groupName) ||
      a.counterpartyName.localeCompare(b.counterpartyName) ||
      a.counterpartyId.localeCompare(b.counterpartyId),
  );
  return {
    groups,
    totals: [...totals.values()].sort((a, b) => compareCurrencies(a.currency, b.currency)),
    transfers,
  };
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
