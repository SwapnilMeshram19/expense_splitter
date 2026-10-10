import type { AppDb } from '@/db/context';
import { isGroupLost } from '@/db/repositories/access';
import { groupActivityQuery } from '@/db/repositories/activity';
import { groupExpensesQuery } from '@/db/repositories/expenses';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { groupSettlementsQuery } from '@/db/repositories/settlements';
import type { Expense, Group, Settlement } from '@/db/schema';
import { computeBalances, computePairwiseDebts, type Debt, type PayerLine } from '@/domain/balances';
import { simplifyDebts } from '@/domain/simplify';
import { describeActivity, formatTimestamp } from '@/features/activity/describeActivity';
import { formatIsoDate, toLocalIsoDate } from '@/lib/dates';

export type HistoryRow =
  | { kind: 'date'; key: string; label: string }
  | {
      kind: 'expense';
      key: string;
      date: string;
      createdAt: number;
      expense: Expense;
      payers: readonly PayerLine[];
      myNet: number;
      involved: boolean;
    }
  | { kind: 'settlement'; key: string; date: string; createdAt: number; settlement: Settlement };

export interface ActivityRow {
  key: string;
  title: string;
  detail: string | null;
  time: string;
}

export interface GroupView {
  group: Group;
  me: string | null;
  lost: boolean;
  /** Writes allowed: I'm a member and access hasn't been revoked. */
  canEdit: boolean;
  names: Map<string, string>;
  /** Active members, in the order they joined (avatar stack, balances). */
  activeMembers: { id: string; name: string }[];
  invalidCount: number;
  transfers: Debt[];
  /** Newest first, with a date header row before each calendar day. */
  history: HistoryRow[];
  expenseCount: number;
  /** Active members plus anyone who left with a non-zero balance. */
  memberBalances: { id: string; balance: number }[];
  myBalance: number;
  activity: ActivityRow[];
}

/** "Today" / "Yesterday" / "7 Oct 2026", against the phone's local calendar day. */
export function dateLabel(isoDate: string, todayIso: string): string {
  if (isoDate === todayIso) return 'Today';
  const [y, m, d] = todayIso.split('-').map(Number);
  const yesterday = toLocalIsoDate(new Date(y!, m! - 1, d! - 1));
  if (isoDate === yesterday) return 'Yesterday';
  return formatIsoDate(isoDate);
}

/** Insert a date header before each new calendar day. Rows must already be sorted newest first. */
export function withDateHeaders(
  rows: Exclude<HistoryRow, { kind: 'date' }>[],
  todayIso: string,
): HistoryRow[] {
  const result: HistoryRow[] = [];
  let lastDate: string | null = null;
  for (const row of rows) {
    if (row.date !== lastDate) {
      result.push({ kind: 'date', key: `d-${row.date}`, label: dateLabel(row.date, todayIso) });
      lastDate = row.date;
    }
    result.push(row);
  }
  return result;
}

export function loadGroupView(db: AppDb, groupId: string, deviceUserId: string, todayIso: string): GroupView | null {
  const group = getGroup(db, groupId);
  if (!group) return null;

  const me = findSelfMemberId(db, groupId, deviceUserId);
  const lost = isGroupLost(db, groupId);
  const allMembers = groupMembersQuery(db, groupId).all();
  const names = new Map(allMembers.map((m) => [m.id, m.displayName]));

  const ledger = loadGroupLedger(db, groupId);
  const { balances, invalidIds } = computeBalances(ledger.expenses, ledger.settlements);
  const transfers = group.simplifyDebts
    ? simplifyDebts(balances)
    : computePairwiseDebts(ledger.expenses, ledger.settlements).debts;

  const linesById = new Map(ledger.expenses.map((e) => [e.id, e]));
  const expenseRows = groupExpensesQuery(db, groupId)
    .all()
    .map((expense) => {
      const payers = linesById.get(expense.id)?.payers ?? [];
      const shares = linesById.get(expense.id)?.shares ?? [];
      const myPaid = payers.find((p) => p.memberId === me)?.amountPaise ?? 0;
      const myShare = shares.find((s) => s.memberId === me)?.amountPaise ?? 0;
      return {
        kind: 'expense' as const,
        key: `e-${expense.id}`,
        date: expense.expenseDate,
        createdAt: expense.createdAt,
        expense,
        payers,
        myNet: myPaid - myShare,
        involved: payers.some((p) => p.memberId === me) || shares.some((s) => s.memberId === me),
      };
    });

  const settlementRows = groupSettlementsQuery(db, groupId)
    .all()
    .map((settlement) => ({
      kind: 'settlement' as const,
      key: `s-${settlement.id}`,
      date: toLocalIsoDate(new Date(settlement.settledAt)),
      createdAt: settlement.createdAt,
      settlement,
    }));

  // Newest first: by calendar date, then by creation time within the same day.
  const sorted = [...expenseRows, ...settlementRows].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.createdAt - a.createdAt,
  );

  const nameOf = (id: string) => names.get(id) ?? 'Someone';
  const activity = groupActivityQuery(db, groupId)
    .all()
    .map((entry) => ({
      key: entry.id,
      ...describeActivity(entry, { me, nameOf, currency: group.currency }),
      time: formatTimestamp(entry.createdAt),
    }));

  return {
    group,
    me,
    lost,
    canEdit: me !== null && !lost,
    names,
    activeMembers: allMembers.filter((m) => m.deletedAt === null).map((m) => ({ id: m.id, name: m.displayName })),
    invalidCount: invalidIds.length,
    transfers,
    history: withDateHeaders(sorted, todayIso),
    expenseCount: expenseRows.length,
    memberBalances: allMembers
      .filter((m) => m.deletedAt === null || (balances.get(m.id) ?? 0) !== 0)
      .map((m) => ({ id: m.id, balance: balances.get(m.id) ?? 0 })),
    myBalance: me ? (balances.get(me) ?? 0) : 0,
    activity,
  };
}

export const GROUP_VIEW_TABLES = [
  'groups',
  'members',
  'expenses',
  'expense_payers',
  'expense_shares',
  'settlements',
  'settings',
  'activity_log',
] as const;
