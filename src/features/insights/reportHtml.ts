/**
 * HTML for the PDF report (expo-print turns it into an A4 PDF on the phone; nothing is uploaded).
 *
 * Every user-typed string (group, member names, descriptions, notes, custom categories) goes
 * through escapeHtml: the print WebView would otherwise render markup or run scripts from them.
 * No external resources (fonts, images, CSS): the PDF works offline and leaks nothing.
 */

import type { BudgetStatus } from '@/domain/budget';
import { formatMoney, type CurrencyCode } from '@/domain/currency';
import { categoryDisplayName } from '@/features/expenses/categoryNames';
import { formatIsoDate } from '@/lib/dates';

import {
  categoryTotals,
  inPeriod,
  memberTotals,
  monthLabel,
  monthlyTotals,
  chartMonths,
  summarize,
  type InsightExpense,
  type InsightMember,
  type Period,
} from './compute';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ReportInput {
  groupName: string;
  currency: CurrencyCode;
  members: readonly InsightMember[];
  expenses: readonly InsightExpense[];
  period: Period;
  today: string;
  /** Current balances (all-time report only), member id → minor units. */
  balances: ReadonlyMap<string, number> | null;
  budget: BudgetStatus | null;
}

const bar = (ratio: number) =>
  `<div class="track"><div class="fill" style="width:${Math.max(0, Math.min(1, ratio)) * 100}%"></div></div>`;

export function buildReportHtml(input: ReportInput): string {
  const { groupName, currency, members, expenses, period, today, balances, budget } = input;
  const money = (minor: number) => escapeHtml(formatMoney(minor, currency));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Unknown member';
  const e = escapeHtml;

  const months =
    period === null ? monthlyTotals(expenses, chartMonths(expenses, today), 'group', null) : [];
  const summary = summarize(expenses, months, period, 'group', null);
  const categories = categoryTotals(expenses, period, 'group', null);
  const people = memberTotals(expenses, members, period);
  const list = expenses
    .filter((x) => inPeriod(x.date, period))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt - b.createdAt));

  const periodText = period === null ? 'All time' : monthLabel(period, 'long');
  const tiles = [
    ['Total spent', money(summary.total)],
    ['Expenses', String(summary.count)],
    summary.monthlyAverage !== null && months.length > 1
      ? [`Average per month (last ${months.length})`, money(summary.monthlyAverage)]
      : null,
    summary.largest
      ? [
          'Largest expense',
          `${money(summary.largest.amount)}<small>${e(summary.largest.description)}</small>`,
        ]
      : null,
    // The budget status is for now: the whole trip, or this month. Only shown where it matches.
    budget && (budget.period === 'total' ? period === null : period === budget.month)
      ? [
          budget.period === 'monthly' ? 'Monthly budget' : 'Budget',
          `${money(budget.spent)} of ${money(budget.limit)}<small>${budget.remaining >= 0 ? `${money(budget.remaining)} left` : `${money(-budget.remaining)} over`}</small>`,
        ]
      : null,
  ].filter((t): t is string[] => t !== null);

  const maxMonth = Math.max(1, ...months.map((m) => m.total));
  const monthSection =
    months.length > 1
      ? `<h2>By month</h2><table><thead><tr><th>Month</th><th class="num">Spent</th><th class="barcol"></th></tr></thead><tbody>${months
          .map(
            (m) =>
              `<tr><td>${e(monthLabel(m.month))}</td><td class="num">${money(m.total)}</td><td>${bar(m.total / maxMonth)}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '';

  const categorySection = categories.length
    ? `<h2>By category</h2><table><thead><tr><th>Category</th><th class="num">Bills</th><th class="num">Spent</th><th class="num">Share</th><th class="barcol"></th></tr></thead><tbody>${categories
        .map(
          (c) =>
            `<tr><td>${e(c.name)}</td><td class="num">${c.count}</td><td class="num">${money(c.total)}</td><td class="num">${c.percent}%</td><td>${bar(c.total / (categories[0]?.total || 1))}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '';

  const memberSection = people.length
    ? `<h2>By person</h2><table><thead><tr><th>Name</th><th class="num">Paid</th><th class="num">Their share</th>${
        balances ? '<th class="num">Balance now</th>' : ''
      }</tr></thead><tbody>${people
        .map((p) => {
          const balance = balances?.get(p.memberId) ?? 0;
          const balanceCell = balances
            ? `<td class="num">${balance === 0 ? 'settled' : balance > 0 ? `gets back ${money(balance)}` : `owes ${money(-balance)}`}</td>`
            : '';
          return `<tr><td>${e(p.name)}${p.active ? '' : ' <small>(left)</small>'}</td><td class="num">${money(p.paid)}</td><td class="num">${money(p.share)}</td>${balanceCell}</tr>`;
        })
        .join('')}</tbody></table>`
    : '';

  const expenseSection = list.length
    ? `<h2>Expenses</h2><table class="list"><thead><tr><th>Date</th><th>Description</th><th>Paid by</th><th class="num">Amount</th></tr></thead><tbody>${list
        .map((x) => {
          const paidBy =
            x.payers.length === 1 ? e(nameOf(x.payers[0]!.memberId)) : `${x.payers.length} people`;
          const foreign =
            x.originalCurrency && x.originalAmountMinor !== null
              ? `<small>${e(formatMoney(x.originalAmountMinor, x.originalCurrency))}</small>`
              : '';
          const detail = [categoryDisplayName(x.category, x.categoryLabel), x.note]
            .filter(Boolean)
            .map((t) => e(t!))
            .join(' · ');
          return `<tr><td class="nowrap">${e(formatIsoDate(x.date))}</td><td>${e(x.description)}<small>${detail}</small></td><td>${paidBy}</td><td class="num">${money(x.amount)}${foreign}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : '<p class="muted">No expenses in this period.</p>';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(groupName)} · ${e(periodText)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, "Noto Sans", "Noto Sans Devanagari", sans-serif; color: #121722; font-size: 11pt; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  h2 { font-size: 13pt; margin: 18pt 0 6pt; }
  .muted, small { color: #5A6474; }
  small { display: block; font-size: 9pt; margin-top: 1pt; }
  .tiles { display: flex; flex-wrap: wrap; gap: 8pt; margin-top: 12pt; }
  .tile { flex: 1 1 30%; border: 1px solid #DCE3EC; border-radius: 8pt; padding: 8pt 10pt; }
  .tile .k { font-size: 9pt; color: #5A6474; }
  .tile .v { font-size: 13pt; font-weight: 600; margin-top: 2pt; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9pt; color: #5A6474; font-weight: 600; border-bottom: 1px solid #DCE3EC; padding: 4pt 6pt; }
  td { border-bottom: 1px solid #EEF2F7; padding: 5pt 6pt; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  .barcol { width: 30%; }
  .track { height: 7pt; background: #E9EEF5; border-radius: 4pt; overflow: hidden; margin-top: 4pt; }
  .fill { height: 100%; background: #0A6AA1; }
  footer { margin-top: 20pt; font-size: 8.5pt; color: #5A6474; }
</style></head>
<body>
  <h1>${e(groupName)}</h1>
  <div class="muted">Spending report · ${e(periodText)} · ${e(currency)} · made ${e(formatIsoDate(today))}</div>
  <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
  ${monthSection}
  ${categorySection}
  ${memberSection}
  ${expenseSection}
  <footer>Expenses only; payments between members are not spending and are left out of these totals${
    balances ? ', but are included in “Balance now”' : ''
  }. Bills paid in another currency are shown at the rate saved with each expense.</footer>
</body></html>`;
}
