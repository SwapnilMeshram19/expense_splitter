import { AppState } from 'react-native';

import { appContext } from '@/db/appContext';
import { generateDueOccurrences } from '@/db/repositories/recurring';
import { getDeviceUserId } from '@/db/session';
import { todayIsoDate } from '@/lib/dates';
import { onSyncSucceeded, syncNow } from '@/sync/syncService';

/**
 * Create due occurrences on this phone. The server does the same every hour; doing it here too means
 * rent dated the 1st shows up on the 1st even offline, and a group that never syncs still works.
 */
export function generateNow(): number {
  try {
    const created = generateDueOccurrences(appContext, getDeviceUserId(), todayIsoDate());
    // Writes made right after a sync don't start another one by themselves: ask for it.
    if (created > 0) setTimeout(() => void syncNow(), 1000);
    return created;
  } catch (e) {
    if (__DEV__) console.log('[recurring] generation failed', (e as Error | null)?.message);
    return 0;
  }
}

/** At start, whenever the app comes to the foreground, and after every successful sync. */
export function startRecurringGenerator(): () => void {
  generateNow();
  const foreground = AppState.addEventListener('change', (state) => {
    if (state === 'active') generateNow();
  });
  const afterSync = onSyncSucceeded(() => {
    generateNow();
  });
  return () => {
    foreground.remove();
    afterSync();
  };
}
