import { Alert } from 'react-native';

import { db } from '@/db/client';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { computeBalances } from '@/domain/balances';

/** After a payment is recorded: if it squared the whole group, say so (once, right then). */
export function celebrateIfSettled(groupId: string): void {
  const group = getGroup(db, groupId);
  if (!group) return;
  const ledger = loadGroupLedger(db, groupId);
  if (ledger.expenses.length === 0) return;
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);
  if ([...balances.values()].every((b) => b === 0)) {
    Alert.alert('All settled up 🎉', `Everyone in “${group.name}” is square.`);
  }
}
