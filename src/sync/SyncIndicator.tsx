import { router } from 'expo-router';
import { ActivityIndicator, Pressable, Text } from 'react-native';

import { useTheme } from '@/ui/theme';

import { useSyncStatus } from './syncService';

/** Compact header status. Hidden when signed out (the header shows "Sign in" instead). */
export function SyncIndicator() {
  const theme = useTheme();
  const sync = useSyncStatus();
  if (sync.state === 'signedOut') return null;

  let label: string;
  let color = theme.muted;
  if (sync.issueCount > 0) {
    label = `⚠ ${sync.issueCount}`;
    color = theme.warning;
  } else if (sync.state === 'syncing') {
    return <ActivityIndicator size="small" color={theme.muted} />;
  } else if (sync.errorCode === 'OFFLINE') {
    label = 'Offline';
  } else if (sync.state === 'error') {
    label = 'Sync error';
    color = theme.negative;
  } else if (sync.pendingCount > 0) {
    label = 'Pending';
  } else if (sync.lastSyncedAt !== null) {
    label = '✓ Synced';
  } else {
    return null;
  }

  return (
    <Pressable
      onPress={() => router.push('/sync')}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`Sync status: ${label}`}
    >
      <Text style={{ color, fontSize: 14, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}