import type { IconName } from '@/ui/Icon';
import type { Theme } from '@/ui/palette';

import type { SyncStatus } from './syncService';

export interface SyncStateView {
  icon: IconName | 'spinner';
  color: string;
  /** Spoken and shown text. */
  label: string;
  /** True only when the user should look: the header icon appears for these states alone. */
  attention: boolean;
}

/**
 * One description of the sync state for every surface. Normal states (synced, syncing, a change
 * about to be sent while online) are quiet: sync is automatic and needs no attention. The header
 * shows an icon only for problems or for changes waiting on an offline phone.
 */
export function describeSyncState(sync: SyncStatus, theme: Theme): SyncStateView | null {
  if (sync.state === 'signedOut') return null;

  if (sync.issueCount > 0) {
    const label = sync.issueCount === 1 ? '1 change needs your attention' : `${sync.issueCount} changes need your attention`;
    return { icon: 'syncProblem', color: theme.warning, label, attention: true };
  }
  if (sync.errorCode === 'OFFLINE') {
    if (sync.pendingCount > 0) {
      const changes = sync.pendingCount === 1 ? '1 change' : `${sync.pendingCount} changes`;
      return { icon: 'cloudOff', color: theme.muted, label: `Offline · ${changes} saved on this phone`, attention: true };
    }
    return { icon: 'cloudOff', color: theme.muted, label: 'Offline · will sync when you’re back online', attention: false };
  }
  if (sync.state === 'error') {
    return { icon: 'syncProblem', color: theme.negative, label: sync.message ?? 'Sync failed. It will try again shortly.', attention: true };
  }
  if (sync.state === 'syncing') return { icon: 'spinner', color: theme.muted, label: 'Syncing…', attention: false };
  if (sync.lastSyncedAt === null) return { icon: 'cloudSync', color: theme.muted, label: 'Not synced yet on this phone', attention: false };

  const time = new Date(sync.lastSyncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return { icon: 'cloudDone', color: theme.primary, label: `All changes synced · ${time}`, attention: false };
}
