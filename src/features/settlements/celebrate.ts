import { Alert } from 'react-native';

import { dataStore } from '@/data';
import { balancesOf } from '@/data/selectors';

/** After a payment is recorded: if it squared the whole group, say so (once, right then). */
export function celebrateIfSettled(groupId: string): void {
  const snapshot = dataStore().group(groupId);
  if (!snapshot || snapshot.expenses.length === 0) return;
  if ([...balancesOf(snapshot).values()].every((b) => b === 0)) {
    Alert.alert('All settled up 🎉', `Everyone in “${snapshot.group.name}” is square.`);
  }
}
