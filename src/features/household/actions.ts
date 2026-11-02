import { dataStore } from '@/data';
import { runCommand } from '@/data/hooks';
import { markValue } from '@/domain/commands';

import { describeHouseholdError } from './messages';

const nameIn = (groupId: string) => (memberId: string) =>
  dataStore()
    .group(groupId)
    ?.members.find((m) => m.id === memberId)?.displayName ?? 'Someone';

/**
 * Set one day (null = back to usual). Sends what the day was on this phone as `expected`, so a
 * flatmate's mark made meanwhile is never silently overwritten. Works offline: it waits in the
 * queue. Returns an error text, or null when saved or queued.
 */
export async function saveMark(
  groupId: string,
  serviceId: string,
  date: string,
  qty: number | null,
): Promise<string | null> {
  const snapshot = dataStore().group(groupId);
  const expected = snapshot ? markValue(snapshot, serviceId, date) : null;
  const result = await runCommand('household.mark', { groupId, serviceId, date, qty, expected });
  if (result.ok) return null;
  return describeHouseholdError(result.error, nameIn(groupId), snapshot?.group.currency ?? 'INR');
}

export { nameIn };
