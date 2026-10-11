/**
 * CSV export of a group's expenses and payments, for Excel / Google Sheets.
 *
 * Layout (one row per expense or payment, oldest first, RFC 4180, CRLF line ends):
 *   Date, Type, Description, Category, Amount, Currency, Original amount, Original currency,
 *   Paid by, Note, <one column per member>
 * A member column is that row's effect on the member's balance: what they paid minus their share
 * for an expense; +amount for whoever paid a payment, −amount for whoever received it. The last
 * row adds the columns up, so for "all time" it equals the balances in the app, and the sheet can
 * be checked with a SUM.
 *
 * Amounts are plain decimals ("1234.50", no grouping, "." separator) so spreadsheets in any locale
 * read them as numbers. The file starts with a UTF-8 BOM so Excel shows ₹ and Indian-language
 * names correctly.
 *
 * Security: names, descriptions and notes are typed by other group members. A cell starting with
 * = + - @ (or a tab/CR) would run as a formula in Excel ("CSV injection"), so such text gets a
 * leading apostrophe. Only text cells; the numbers are ours.
 */

import { minorDigits, type CurrencyCode } from '@/domain/currency';
import { categoryDisplayName } from '@/features/expenses/categoryNames';

import {
  inPeriod,
  monthLabel,
  type InsightExpense,
  type InsightMember,
  type InsightSettlement,
  type Period,
} from './compute';

export const CSV_BOM = '﻿';
const EOL = '\r\n';

const METHOD_NAMES: Record<string, string> = { upi: 'UPI', cash: 'Cash', other: 'Other' };

/** A text cell: formula-neutralised and always quoted. */
export function csvText(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Minor units → plain decimal string in the currency's digits: 123450 INR → "1234.50", 1500 JPY → "1500". */
export function minorToDecimal(minor: number, currency: CurrencyCode): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`Invalid amount: ${minor}`);
  const digits = minorDigits(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  if (digits === 0) return `${sign}${abs}`;
  const scale = 10 ** digits;
  return `${sign}${Math.floor(abs / scale)}.${String(abs % scale).padStart(digits, '0')}`;
}

/** Column titles for members: "Rahul", a second "Rahul" becomes "Rahul (2)", leavers get "(left)". */
export function memberColumnTitles(members: readonly InsightMember[]): string[] {
  const seen = new Map<string, number>();
  return members.map((m) => {
    const base = m.active ? m.name : `${m.name} (left)`;
    const key = base.toLocaleLowerCase('en-IN');
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

export interface CsvInput {
  currency: CurrencyCode;
  members: readonly InsightMember[];
  expenses: readonly InsightExpense[];
  settlements: readonly InsightSettlement[];
  period: Period;
}

type Row =
  | { kind: 'expense'; date: string; createdAt: number; expense: InsightExpense }
  | { kind: 'payment'; date: string; createdAt: number; settlement: InsightSettlement };

export function buildExpensesCsv({
  currency,
  members,
  expenses,
  settlements,
  period,
}: CsvInput): string {
  const rows: Row[] = [
    ...expenses
      .filter((e) => inPeriod(e.date, period))
      .map((expense) => ({
        kind: 'expense' as const,
        date: expense.date,
        createdAt: expense.createdAt,
        expense,
      })),
    ...settlements
      .filter((s) => inPeriod(s.date, period))
      .map((settlement) => ({
        kind: 'payment' as const,
        date: settlement.date,
        createdAt: settlement.createdAt,
        settlement,
      })),
  ].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt - b.createdAt));

  // Members who appear in this period, plus everyone still in the group (empty columns are fine
  // there: they show who was part of it). Join order.
  const involved = new Set<string>();
  for (const row of rows) {
    if (row.kind === 'expense') {
      for (const l of [...row.expense.payers, ...row.expense.shares]) involved.add(l.memberId);
    } else {
      involved.add(row.settlement.fromMemberId);
      involved.add(row.settlement.toMemberId);
    }
  }
  const known = new Set(members.map((m) => m.id));
  const columns: InsightMember[] = [
    ...members.filter((m) => m.active || involved.has(m.id)),
    // A line naming a member this phone doesn't have (shouldn't happen) still adds up.
    ...[...involved]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: 'Unknown member', active: false })),
  ];
  const index = new Map(columns.map((m, i) => [m.id, i]));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Unknown member';
  const money = (minor: number) => minorToDecimal(minor, currency);

  const header = [
    'Date',
    'Type',
    'Description',
    'Category',
    'Amount',
    'Currency',
    'Original amount',
    'Original currency',
    'Paid by',
    'Note',
    ...memberColumnTitles(columns),
  ].map(csvText);

  const lines = [header.join(',')];
  const totals = columns.map(() => 0);

  for (const row of rows) {
    const effect = columns.map(() => 0);
    let cells: string[];
    if (row.kind === 'expense') {
      const e = row.expense;
      for (const p of e.payers) effect[index.get(p.memberId)!]! += p.amountPaise;
      for (const s of e.shares) effect[index.get(s.memberId)!]! -= s.amountPaise;
      const paidBy =
        e.payers.length === 1
          ? nameOf(e.payers[0]!.memberId)
          : e.payers.map((p) => `${nameOf(p.memberId)} ${money(p.amountPaise)}`).join('; ');
      const foreign = e.originalCurrency && e.originalAmountMinor !== null;
      cells = [
        csvText(e.date),
        csvText('Expense'),
        csvText(e.description),
        csvText(categoryDisplayName(e.category, e.categoryLabel)),
        money(e.amount),
        csvText(currency),
        foreign ? minorToDecimal(e.originalAmountMinor!, e.originalCurrency!) : '',
        foreign ? csvText(e.originalCurrency) : '',
        csvText(paidBy),
        csvText(e.note),
      ];
    } else {
      const s = row.settlement;
      effect[index.get(s.fromMemberId)!]! += s.amount;
      effect[index.get(s.toMemberId)!]! -= s.amount;
      cells = [
        csvText(s.date),
        csvText('Payment'),
        csvText(`${nameOf(s.fromMemberId)} paid ${nameOf(s.toMemberId)}`),
        csvText(METHOD_NAMES[s.method] ?? 'Other'),
        money(s.amount),
        csvText(currency),
        '',
        '',
        csvText(nameOf(s.fromMemberId)),
        csvText(s.note),
      ];
    }
    effect.forEach((v, i) => {
      totals[i]! += v;
    });
    lines.push([...cells, ...effect.map(money)].join(','));
  }

  const totalLabel = period === null ? 'Balance' : `Total for ${monthLabel(period, 'long')}`;
  lines.push(
    ['', '', csvText(totalLabel), '', '', '', '', '', '', '', ...totals.map(money)].join(','),
  );

  return CSV_BOM + lines.join(EOL) + EOL;
}
