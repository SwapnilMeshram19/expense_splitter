/**
 * Ready-to-send texts for WhatsApp (they read fine in any other app too).
 *
 * Pure: no React, no database. Callers pass names and amounts already resolved.
 * - Real names only, never "You": the text is read by other people.
 * - WhatsApp formatting: *bold* for the group name and totals. Names and descriptions typed by
 *   users are put in as they are; a stray * or _ in a name can at worst bold a word.
 * - Lists are capped so a big group doesn't produce a wall of text (and the share URL stays short).
 * - UPI IDs are included as plain text: WhatsApp doesn't make upi:// links tappable, but people
 *   long-press to copy an ID, and every UPI app has "Pay to UPI ID".
 */

import { formatMoney, type CurrencyCode } from '@/domain/currency';
import { formatIsoDate } from '@/lib/dates';

export const MAX_LIST_LINES = 12;
export const SHARE_FOOTER = '— via Expense Splitter';

const listWithMore = (lines: readonly string[], max = MAX_LIST_LINES): string[] =>
  lines.length <= max
    ? [...lines]
    : [...lines.slice(0, max - 1), `…and ${lines.length - (max - 1)} more`];

/** One line of text: newlines and runs of spaces collapsed (keeps a long note from breaking the layout). */
export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export interface BalancesShareInput {
  groupName: string;
  currency: CurrencyCode;
  transfers: readonly { fromMemberId: string; toMemberId: string; amountPaise: number }[];
  /** Member id → display name. */
  names: ReadonlyMap<string, string>;
  /** Member id → UPI ID, for people who receive money (INR groups only). */
  upiIds: ReadonlyMap<string, string>;
  totalSpent: number;
  expenseCount: number;
}

/** "Who pays whom" for the group chat, with the receivers' UPI IDs. */
export function balancesMessage(input: BalancesShareInput): string {
  const { groupName, currency, transfers, names, upiIds, totalSpent, expenseCount } = input;
  const money = (minor: number) => formatMoney(minor, currency);
  const name = (id: string) => names.get(id) ?? 'Someone';

  const lines = [`*${oneLine(groupName)}*`];
  if (expenseCount > 0) {
    lines.push(
      `Spent so far: *${money(totalSpent)}* (${expenseCount} expense${expenseCount === 1 ? '' : 's'})`,
    );
  }
  lines.push('');

  if (transfers.length === 0) {
    lines.push('Everyone is settled up ✅');
  } else {
    lines.push('To settle up:');
    lines.push(
      ...listWithMore(
        transfers.map(
          (t) => `• ${name(t.fromMemberId)} → ${name(t.toMemberId)}: *${money(t.amountPaise)}*`,
        ),
      ),
    );

    // UPI IDs of everyone who gets money, once each, in the order they appear above.
    const receivers = [...new Set(transfers.map((t) => t.toMemberId))].filter((id) =>
      upiIds.has(id),
    );
    if (currency === 'INR' && receivers.length > 0) {
      lines.push('', 'UPI:');
      lines.push(...listWithMore(receivers.map((id) => `• ${name(id)}: ${upiIds.get(id)}`)));
    }
  }

  lines.push('', SHARE_FOOTER);
  return lines.join('\n');
}

export interface ExpenseShareInput {
  groupName: string;
  currency: CurrencyCode;
  description: string;
  amountPaise: number;
  /** A foreign bill as paid ("$45.50"), or null. */
  original: { currency: CurrencyCode; amountMinor: number } | null;
  date: string;
  categoryName: string;
  note: string | null;
  payers: readonly { name: string; amountPaise: number }[];
  shares: readonly { name: string; amountPaise: number }[];
}

/** One expense, with who paid and everyone's share. */
export function expenseMessage(input: ExpenseShareInput): string {
  const {
    groupName,
    currency,
    description,
    amountPaise,
    original,
    date,
    categoryName,
    note,
    payers,
    shares,
  } = input;
  const money = (minor: number) => formatMoney(minor, currency);
  const total = original
    ? `${formatMoney(original.amountMinor, original.currency)} (${money(amountPaise)})`
    : money(amountPaise);

  const paidBy =
    payers.length === 1
      ? `Paid by ${payers[0]!.name}`
      : `Paid by ${payers.map((p) => `${p.name} ${money(p.amountPaise)}`).join(', ')}`;

  const lines = [
    `*${oneLine(description)}*: *${total}*`,
    `${oneLine(groupName)} · ${categoryName} · ${formatIsoDate(date)}`,
    paidBy,
    '',
    'Shares:',
    ...listWithMore(
      shares.filter((s) => s.amountPaise !== 0).map((s) => `• ${s.name}: ${money(s.amountPaise)}`),
    ),
  ];
  if (note) lines.push('', `Note: ${oneLine(note)}`);
  lines.push('', SHARE_FOOTER);
  return lines.join('\n');
}

export interface ReminderInput {
  groupName: string;
  currency: CurrencyCode;
  debtorName: string;
  /** null: no amount (a general nudge). */
  amountPaise: number | null;
  /** My UPI ID, or null. */
  upiId: string | null;
  /** Non-INR group: the amount in rupees for UPI (today's rate), or null to leave UPI out. */
  inrPaise?: number | null;
  /** Other ways to pay, one line each ("PayPal: https://paypal.me/asha/12.50EUR"). */
  otherWays?: readonly string[];
}

/** A friendly payment reminder to one person. */
export function reminderMessage({
  groupName,
  currency,
  debtorName,
  amountPaise,
  upiId,
  inrPaise,
  otherWays = [],
}: ReminderInput): string {
  const amount =
    amountPaise !== null && amountPaise > 0 ? ` *${formatMoney(amountPaise, currency)}*` : '';
  const lines = [
    `Hi ${oneLine(debtorName)}, a gentle reminder to settle${amount} for “${oneLine(groupName)}”.`,
  ];
  const before = lines.length;
  if (upiId && currency === 'INR') lines.push(`You can pay me on UPI: ${upiId}`);
  else if (upiId && inrPaise) lines.push(`You can pay me ${formatMoney(inrPaise, 'INR')} on UPI: ${upiId}`);
  if (otherWays.length > 0) {
    lines.push(lines.length > before ? 'Or:' : 'You can pay me here:');
    lines.push(...otherWays.slice(0, 6).map((w) => `• ${oneLine(w)}`));
  }
  lines.push('Thanks! 🙏', '', SHARE_FOOTER);
  return lines.join('\n');
}

export interface SpendingShareInput {
  groupName: string;
  currency: CurrencyCode;
  /** "October 2026" or "All time". */
  periodName: string;
  total: number;
  count: number;
  categories: readonly { name: string; total: number; percent: number }[];
}

/** A short spending summary: total and the top categories. */
export function spendingMessage({
  groupName,
  currency,
  periodName,
  total,
  count,
  categories,
}: SpendingShareInput): string {
  const money = (minor: number) => formatMoney(minor, currency);
  const lines = [
    `*${oneLine(groupName)}* · ${periodName}`,
    `Spent: *${money(total)}* (${count} expense${count === 1 ? '' : 's'})`,
  ];
  if (categories.length > 0) {
    lines.push('', 'Top categories:');
    lines.push(
      ...categories.slice(0, 5).map((c) => `• ${c.name}: ${money(c.total)} (${c.percent}%)`),
    );
  }
  lines.push('', SHARE_FOOTER);
  return lines.join('\n');
}
