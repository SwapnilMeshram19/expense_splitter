/**
 * Spending insights for one group: totals by month, by category and by member.
 *
 * Pure functions over the group's ledger (no React, no database), so the screen, the PDF and the
 * tests all count the same way. Everything is in minor units of the group currency: a group has
 * exactly one currency, so nothing here converts or rounds. Foreign bills already carry their
 * converted amount (locked when the expense was saved).
 *
 * "Spent" means expenses, counted on their expense date. Payments (settle-ups) move money between
 * members but aren't spending, so they never appear in these totals.
 */

import { categoryLabelKey } from '@/domain/categoryLabel';
import { categoryDisplayName } from '@/features/expenses/categoryNames';

export interface InsightLine {
  memberId: string;
  amountPaise: number;
}

export interface InsightExpense {
  id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  createdAt: number;
  description: string;
  category: string;
  categoryLabel: string | null;
  /** Group currency, minor units. */
  amount: number;
  originalCurrency: string | null;
  originalAmountMinor: number | null;
  note: string | null;
  payers: readonly InsightLine[];
  shares: readonly InsightLine[];
}

export interface InsightSettlement {
  id: string;
  /** Local calendar date of the payment, 'YYYY-MM-DD'. */
  date: string;
  createdAt: number;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  method: string;
  note: string | null;
}

export interface InsightMember {
  id: string;
  name: string;
  /** Still in the group. */
  active: boolean;
}

/** Whose spending: the whole group's bills, or only my shares of them. */
export type InsightScope = 'group' | 'mine';

/** A month as 'YYYY-MM'; null means all time. */
export type Period = string | null;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const monthOfDate = (isoDate: string): string => isoDate.slice(0, 7);

/** '2026-10' → 'Oct 2026' (short) or 'October 2026'. */
export function monthLabel(month: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = month.split('-');
  const names = style === 'short' ? MONTHS : FULL_MONTHS;
  const name = names[Number(m) - 1];
  return name ? `${name} ${y}` : month;
}

/** '2026-10' → 'Oct'. */
export const monthShortName = (month: string): string =>
  MONTHS[Number(month.slice(5, 7)) - 1] ?? month;

/** '2026-10' + n months (n may be negative). */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const year = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(year).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`;
}

/** Every month from `first` to `last`, inclusive (empty if first > last). */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Amount of one expense in a scope: the bill, or my share of it (0 if I'm not in it). */
export function amountFor(expense: InsightExpense, scope: InsightScope, me: string | null): number {
  if (scope === 'group') return expense.amount;
  if (!me) return 0;
  return expense.shares.find((s) => s.memberId === me)?.amountPaise ?? 0;
}

export const inPeriod = (date: string, period: Period): boolean =>
  period === null || monthOfDate(date) === period;

/**
 * Months the chart shows: up to `max` months ending at the later of this month and the newest
 * expense (a bill dated ahead still shows), starting no earlier than the first expense. Months
 * without spending stay in, as zero bars: gaps are information too.
 */
export function chartMonths(
  expenses: readonly InsightExpense[],
  today: string,
  max = 12,
): string[] {
  if (expenses.length === 0) return [];
  let first = monthOfDate(expenses[0]!.date);
  let last = monthOfDate(today);
  for (const e of expenses) {
    const m = monthOfDate(e.date);
    if (m < first) first = m;
    if (m > last) last = m;
  }
  const earliest = addMonths(last, -(max - 1));
  return monthRange(first > earliest ? first : earliest, last);
}

export interface MonthTotal {
  month: string;
  total: number;
  count: number;
}

export function monthlyTotals(
  expenses: readonly InsightExpense[],
  months: readonly string[],
  scope: InsightScope,
  me: string | null,
): MonthTotal[] {
  const byMonth = new Map(months.map((m) => [m, { month: m, total: 0, count: 0 }]));
  for (const e of expenses) {
    const bucket = byMonth.get(monthOfDate(e.date));
    const amount = amountFor(e, scope, me);
    if (!bucket || amount === 0) continue;
    bucket.total += amount;
    bucket.count += 1;
  }
  return months.map((m) => byMonth.get(m)!);
}

/**
 * Whole-number percentages that add up to exactly 100 (largest remainder), so a breakdown never
 * reads "33% + 33% + 33%". All zeros when the total is zero.
 */
export function percentages(values: readonly number[]): number[] {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v * 100) / total);
  const result = exact.map(Math.floor);
  let left = 100 - result.reduce((sum, v) => sum + v, 0);
  const order = exact
    .map((v, i) => ({ i, rest: v - Math.floor(v) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    result[i]! += 1;
    left -= 1;
  }
  return result;
}

export interface CategoryTotal {
  /** Stable key: the category, or 'other:<label key>' for a custom name. */
  key: string;
  category: string;
  /** Custom name ("Petrol") or null. */
  label: string | null;
  name: string;
  total: number;
  count: number;
  percent: number;
}

/**
 * Spending per category, largest first. Custom names count as their own category ("Petrol" and
 * "petrol" are one), since that's how people think of them.
 */
export function categoryTotals(
  expenses: readonly InsightExpense[],
  period: Period,
  scope: InsightScope,
  me: string | null,
): CategoryTotal[] {
  const byKey = new Map<string, Omit<CategoryTotal, 'percent'>>();
  for (const e of expenses) {
    if (!inPeriod(e.date, period)) continue;
    const amount = amountFor(e, scope, me);
    if (amount === 0) continue;
    const label = e.category === 'other' && e.categoryLabel ? e.categoryLabel : null;
    const key = label ? `other:${categoryLabelKey(label)}` : e.category;
    const bucket = byKey.get(key) ?? {
      key,
      category: e.category,
      label,
      name: categoryDisplayName(e.category, label),
      total: 0,
      count: 0,
    };
    bucket.total += amount;
    bucket.count += 1;
    byKey.set(key, bucket);
  }
  const sorted = [...byKey.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  const pct = percentages(sorted.map((c) => c.total));
  return sorted.map((c, i) => ({ ...c, percent: pct[i]! }));
}

export interface MemberTotal {
  memberId: string;
  name: string;
  active: boolean;
  /** Paid towards bills in the period. */
  paid: number;
  /** Their share of bills in the period (what they "spent"). */
  share: number;
  /** Share as a part of the period's total. */
  percent: number;
}

/** Paid and consumed per member, by share (largest first). Members with neither are left out. */
export function memberTotals(
  expenses: readonly InsightExpense[],
  members: readonly InsightMember[],
  period: Period,
): MemberTotal[] {
  const byId = new Map<string, { paid: number; share: number }>();
  const entry = (id: string) => {
    let e = byId.get(id);
    if (!e) {
      e = { paid: 0, share: 0 };
      byId.set(id, e);
    }
    return e;
  };
  for (const e of expenses) {
    if (!inPeriod(e.date, period)) continue;
    for (const p of e.payers) entry(p.memberId).paid += p.amountPaise;
    for (const s of e.shares) entry(s.memberId).share += s.amountPaise;
  }
  const info = new Map(members.map((m) => [m.id, m]));
  const rows = [...byId.entries()]
    .filter(([, v]) => v.paid !== 0 || v.share !== 0)
    .map(([memberId, v]) => ({
      memberId,
      name: info.get(memberId)?.name ?? 'Unknown member',
      active: info.get(memberId)?.active ?? false,
      ...v,
    }))
    .sort((a, b) => b.share - a.share || b.paid - a.paid || a.name.localeCompare(b.name));
  const pct = percentages(rows.map((r) => r.share));
  return rows.map((r, i) => ({ ...r, percent: pct[i]! }));
}

export interface PeriodSummary {
  total: number;
  count: number;
  /** The largest single amount in the period (bill, or my share), or null with none. */
  largest: { expenseId: string; description: string; amount: number } | null;
  /** All time: average per month over the chart's months. A month: null. */
  monthlyAverage: number | null;
  /** A month: the total of the month before it, for "more/less than". All time: null. */
  previousTotal: number | null;
}

export function summarize(
  expenses: readonly InsightExpense[],
  months: readonly MonthTotal[],
  period: Period,
  scope: InsightScope,
  me: string | null,
): PeriodSummary {
  let total = 0;
  let count = 0;
  let largest: PeriodSummary['largest'] = null;
  let previousTotal = 0;
  const previous = period === null ? null : addMonths(period, -1);

  for (const e of expenses) {
    const amount = amountFor(e, scope, me);
    if (amount === 0) continue;
    if (previous !== null && monthOfDate(e.date) === previous) previousTotal += amount;
    if (!inPeriod(e.date, period)) continue;
    total += amount;
    count += 1;
    if (!largest || amount > largest.amount) {
      largest = { expenseId: e.id, description: e.description, amount };
    }
  }

  const chartTotal = months.reduce((sum, m) => sum + m.total, 0);
  return {
    total,
    count,
    largest,
    // Integer division of minor units: an average is a hint, a paisa either way doesn't matter.
    monthlyAverage:
      period === null && months.length > 0 ? Math.round(chartTotal / months.length) : null,
    previousTotal: period === null ? null : previousTotal,
  };
}

export interface Insights {
  months: MonthTotal[];
  categories: CategoryTotal[];
  /** Group scope only; empty for "just me". */
  members: MemberTotal[];
  summary: PeriodSummary;
}

/** Everything the insights screen shows for one scope and period. */
export function computeInsights(
  expenses: readonly InsightExpense[],
  members: readonly InsightMember[],
  options: { scope: InsightScope; me: string | null; period: Period; today: string },
): Insights {
  const { scope, me, period, today } = options;
  const months = monthlyTotals(expenses, chartMonths(expenses, today), scope, me);
  return {
    months,
    categories: categoryTotals(expenses, period, scope, me),
    members: scope === 'group' ? memberTotals(expenses, members, period) : [],
    summary: summarize(expenses, months, period, scope, me),
  };
}
