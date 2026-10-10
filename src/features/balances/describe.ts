import { DEFAULT_CURRENCY, formatMoney, type CurrencyCode } from '@/domain/currency';

export type Tone = 'positive' | 'negative' | 'neutral';

export interface BalanceText {
  /** Whole sentence, for accessibility labels: "you lent $6". */
  label: string;
  /** Words before the amount ("you lent"), or the whole label when there's no amount. */
  lead: string;
  /** Formatted amount ("$6"), or null for "settled up" / "not involved". */
  amount: string | null;
  tone: Tone;
}

const text = (lead: string, amount: string | null, tone: Tone): BalanceText => ({
  label: amount ? `${lead} ${amount}` : lead,
  lead,
  amount,
  tone,
});

/** "you are owed ₹600" / "you owe $30" / "settled up". Minor units of `currency`. */
export function describeMyBalance(
  minor: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): BalanceText {
  if (minor > 0) return text('you are owed', formatMoney(minor, currency), 'positive');
  if (minor < 0) return text('you owe', formatMoney(-minor, currency), 'negative');
  return text('settled up', null, 'neutral');
}

/** Per-expense effect on me: "you lent ₹600" / "you borrowed $3". */
export function describeMyExpenseShare(
  netMinor: number,
  involved: boolean,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): BalanceText {
  if (!involved) return text('not involved', null, 'neutral');
  if (netMinor > 0) return text('you lent', formatMoney(netMinor, currency), 'positive');
  if (netMinor < 0) return text('you borrowed', formatMoney(-netMinor, currency), 'negative');
  return text('no balance', null, 'neutral');
}
