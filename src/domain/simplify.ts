/**
 * Debt simplification: turn net balances into a small set of transfers.
 *
 * Greedy: repeatedly match the largest debtor with the largest creditor.
 * Produces at most (non-zero members − 1) transfers, is deterministic (ties broken by
 * member id), and runs in O(n² log n), which is trivial for group sizes.
 * Not always the theoretical minimum (that problem is NP-hard); an exact subset-DP
 * for small groups can be added later if needed.
 */
import type { Debt } from './balances';
import type { Paise } from './money';
import { compareMemberIds, type MemberId } from './splits';

interface Party {
  memberId: MemberId;
  amount: number;
}

const byLargestThenId = (a: Party, b: Party) =>
  b.amount - a.amount || compareMemberIds(a.memberId, b.memberId);

/** @throws RangeError if balances are not integers or do not sum to zero (programmer error). */
export function simplifyDebts(balances: ReadonlyMap<MemberId, Paise>): Debt[] {
  const creditors: Party[] = [];
  const debtors: Party[] = [];
  let sum = 0;

  for (const [memberId, amount] of balances) {
    if (!Number.isSafeInteger(amount)) {
      throw new RangeError(`Invalid balance for ${memberId}: ${amount}`);
    }
    sum += amount;
    if (amount > 0) creditors.push({ memberId, amount });
    else if (amount < 0) debtors.push({ memberId, amount: -amount });
  }
  if (sum !== 0) throw new RangeError(`Balances must sum to zero, got ${sum}`);

  const transfers: Debt[] = [];

  for (;;) {
    creditors.sort(byLargestThenId);
    debtors.sort(byLargestThenId);
    const creditor = creditors[0];
    const debtor = debtors[0];
    if (!creditor || !debtor) break;

    const amount = Math.min(creditor.amount, debtor.amount);
    transfers.push({
      fromMemberId: debtor.memberId,
      toMemberId: creditor.memberId,
      amountPaise: amount,
    });

    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount === 0) creditors.shift();
    if (debtor.amount === 0) debtors.shift();
  }

  return transfers;
}