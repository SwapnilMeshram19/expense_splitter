import type { InsightExpense } from '../compute';

let seq = 0;
export function expense(
  date: string,
  amount: number,
  opts: Partial<InsightExpense> & {
    split?: Record<string, number>;
    paidBy?: Record<string, number>;
  } = {},
): InsightExpense {
  const { split = { me: amount }, paidBy = { me: amount }, ...rest } = opts;
  seq += 1;
  return {
    id: `e${seq}`,
    date,
    createdAt: seq,
    description: `Bill ${seq}`,
    category: 'food',
    categoryLabel: null,
    amount,
    originalCurrency: null,
    originalAmountMinor: null,
    note: null,
    payers: Object.entries(paidBy).map(([memberId, amountPaise]) => ({ memberId, amountPaise })),
    shares: Object.entries(split).map(([memberId, amountPaise]) => ({ memberId, amountPaise })),
    ...rest,
  };
}
