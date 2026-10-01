import { formatPaise } from '@/domain/money';

export type Tone = 'positive' | 'negative' | 'neutral';

/** "you are owed ₹600" / "you owe ₹300" / "settled up". */
export function describeMyBalance(paise: number): { label: string; tone: Tone } {
  if (paise > 0) return { label: `you are owed ${formatPaise(paise)}`, tone: 'positive' };
  if (paise < 0) return { label: `you owe ${formatPaise(-paise)}`, tone: 'negative' };
  return { label: 'settled up', tone: 'neutral' };
}

/** Per-expense effect on me: "you lent ₹600" / "you borrowed ₹300". */
export function describeMyExpenseShare(netPaise: number, involved: boolean): { label: string; tone: Tone } {
  if (!involved) return { label: 'not involved', tone: 'neutral' };
  if (netPaise > 0) return { label: `you lent ${formatPaise(netPaise)}`, tone: 'positive' };
  if (netPaise < 0) return { label: `you borrowed ${formatPaise(-netPaise)}`, tone: 'negative' };
  return { label: 'no balance', tone: 'neutral' };
}