/**
 * Where a group was last fully settled: everyone's balance back to zero.
 *
 * Walking the history oldest first, the last step after which every balance is zero splits it in
 * two: everything up to there is settled (paid back in full), everything after is still open.
 * This is exact, not a guess per expense: a partial payment never marks anything settled, and an
 * expense backdated before an old settle-up moves the point back, because then that settle-up no
 * longer covers everything before it.
 *
 * Pure and dependency-free (src/domain).
 */

export interface LedgerStep {
  /** Balance changes: payer +paid / share −share for an expense, payer +x / receiver −x for a payment. */
  deltas: readonly { memberId: string; amount: number }[];
}

/** Index of the last step after which every balance is zero, or -1 if that never happens. */
export function lastSettledIndex(steps: readonly LedgerStep[]): number {
  const balances = new Map<string, number>();
  let nonZero = 0;
  let everOwed = false;
  let last = -1;
  steps.forEach((step, index) => {
    if (step.deltas.length === 0) return; // skipped records (unreadable data) change nothing
    for (const { memberId, amount } of step.deltas) {
      if (amount === 0) continue;
      const before = balances.get(memberId) ?? 0;
      const after = before + amount;
      balances.set(memberId, after);
      if (before === 0 && after !== 0) nonZero++;
      else if (before !== 0 && after === 0) nonZero--;
    }
    // Something must have been owed for "settled" to mean anything: an expense someone paid
    // only for themselves doesn't count as settling up.
    if (nonZero > 0) everOwed = true;
    else if (everOwed) last = index;
  });
  return last;
}
