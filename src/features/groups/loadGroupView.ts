import type { AppDb } from '@/db/context';
import { isGroupLost } from '@/db/repositories/access';
import { groupActivityQuery } from '@/db/repositories/activity';
import { groupExpensesQuery } from '@/db/repositories/expenses';
import { getGroup, groupBudgetStatus } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { groupSettlementsQuery } from '@/db/repositories/settlements';
import type { Expense, Group, Settlement } from '@/db/schema';
import { computeBalances, computePairwiseDebts, type Debt, type PayerLine } from '@/domain/balances';
import type { BudgetStatus } from '@/domain/budget';
import { lastSettledIndex } from '@/domain/settledPoint';
import { simplifyDebts } from '@/domain/simplify';
import { isValidVpa } from '@/domain/upi';
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

/** History up to the last time everyone was square: shown folded away under "Settled up". */
export interface SettledPart {
  /** Date the group was last fully settled ("3 Oct 2026"). */
  through: string;
  expenseCount: number;
  /** Sum of the settled expenses, group currency minor units. */
  total: number;
  /** Newest first, with date headers. */
  history: HistoryRow[];
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
  /** Still open (since the last settle-up): newest first, with a date header before each day. */
  history: HistoryRow[];
  /** Everything up to the last moment all balances were zero, or null if that never happened. */
  settled: SettledPart | null;
  expenseCount: number;
  /** Active members plus anyone who left with a non-zero balance. */
  memberBalances: { id: string; balance: number }[];
  myBalance: number;
  activity: ActivityRow[];
  /** Progress against the group's budget, or null without one. */
  budget: BudgetStatus | null;
  /** Valid UPI IDs of members who have one, for the WhatsApp balances message. */
  upiIds: Map<string, string>;
  /** Sum of all (non-deleted) expenses, group currency minor units. */
  totalSpent: number;
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

  // Where everyone was last square, walking oldest first through the same order.
  const invalid = new Set(invalidIds);
  const settlementById = new Map(ledger.settlements.map((s) => [s.id, s]));
  const oldestFirst = [...sorted].reverse();
  const settledIndex = lastSettledIndex(
    oldestFirst.map((row) => {
      if (row.kind === 'expense') {
        const lines = linesById.get(row.expense.id);
        if (!lines || invalid.has(row.expense.id)) return { deltas: [] };
        return {
          deltas: [
            ...lines.payers.map((p) => ({ memberId: p.memberId, amount: p.amountPaise })),
            ...lines.shares.map((s) => ({ memberId: s.memberId, amount: -s.amountPaise })),
          ],
        };
      }
      const s = settlementById.get(row.settlement.id);
      if (!s || invalid.has(s.id)) return { deltas: [] };
      return {
        deltas: [
          { memberId: s.fromMemberId, amount: s.amountPaise },
          { memberId: s.toMemberId, amount: -s.amountPaise },
        ],
      };
    }),
  );
  const openRows = sorted.slice(0, sorted.length - 1 - settledIndex);
  const settledRows = settledIndex >= 0 ? sorted.slice(sorted.length - 1 - settledIndex) : [];
  const settledExpenses = settledRows.flatMap((row) => (row.kind === 'expense' ? [row.expense] : []));
  const settled: SettledPart | null =
    settledIndex >= 0
      ? {
          through: dateLabel(oldestFirst[settledIndex]!.date, todayIso),
          expenseCount: settledExpenses.length,
          total: settledExpenses.reduce((sum, e) => sum + e.amountPaise, 0),
          history: withDateHeaders(settledRows, todayIso),
        }
      : null;

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
    history: withDateHeaders(openRows, todayIso),
    settled,
    expenseCount: expenseRows.length,
    memberBalances: allMembers
      .filter((m) => m.deletedAt === null || (balances.get(m.id) ?? 0) !== 0)
      .map((m) => ({ id: m.id, balance: balances.get(m.id) ?? 0 })),
    myBalance: me ? (balances.get(me) ?? 0) : 0,
    activity,
    budget: groupBudgetStatus(db, group, todayIso),
    upiIds: new Map(
      allMembers.flatMap((m) =>
        m.deletedAt === null && isValidVpa(m.upiVpa) ? [[m.id, m.upiVpa] as const] : [],
      ),
    ),
    totalSpent: expenseRows.reduce((sum, row) => sum + row.expense.amountPaise, 0),
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
