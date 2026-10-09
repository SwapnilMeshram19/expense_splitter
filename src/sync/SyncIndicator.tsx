import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Icon, type IconName } from '@/ui/Icon';
import { useTheme, type Theme } from '@/ui/theme';

import { useSyncStatus, type SyncStatus } from './syncService';

interface Indicator {
  icon: IconName | 'spinner';
  color: string;
  label: string;
}

export function describeIndicator(sync: SyncStatus, theme: Theme): Indicator | null {
  if (sync.state === 'signedOut') return null;
  if (sync.issueCount > 0) {
    const label = sync.issueCount === 1 ? '1 change needs attention' : `${sync.issueCount} changes need attention`;
    return { icon: 'syncProblem', color: theme.warning, label };
  }
  if (sync.state === 'syncing') return { icon: 'spinner', color: theme.muted, label: 'Syncing' };
  if (sync.errorCode === 'OFFLINE') return { icon: 'cloudOff', color: theme.muted, label: 'Offline, changes saved on this phone' };
  if (sync.state === 'error') return { icon: 'syncProblem', color: theme.negative, label: 'Sync error' };
  if (sync.pendingCount > 0) return { icon: 'cloudSync', color: theme.muted, label: 'Changes waiting to sync' };
  if (sync.lastSyncedAt !== null) return { icon: 'cloudDone', color: theme.primary, label: 'All changes synced' };
  return null;
}

/** Round header button with the sync state; opens the sync details. Hidden when signed out. */
export function SyncIndicator() {
  const theme = useTheme();
  const sync = useSyncStatus();
  const indicator = describeIndicator(sync, theme);
  if (!indicator) return null;

  return (
    <Pressable
      onPress={() => router.push('/sync')}
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${indicator.label}`}
      style={[styles.button, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      {indicator.icon === 'spinner' ? (
        <ActivityIndicator size="small" color={indicator.color} />
      ) : (
        <Icon name={indicator.icon} color={indicator.color} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
