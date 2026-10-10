import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

import { describeSyncState } from './syncState';
import { useSyncStatus } from './syncService';

/**
 * Header icon that appears only when sync needs the user: a conflict to review, an error, or
 * changes stuck on an offline phone. Synced, syncing and "about to send" stay silent, because
 * sync runs on its own. Tapping opens the sync details.
 */
export function SyncIndicator() {
  const theme = useTheme();
  const sync = useSyncStatus();
  const view = describeSyncState(sync, theme);
  if (!view?.attention || view.icon === 'spinner') return null;

  return (
    <Pressable
      onPress={() => router.push('/sync')}
      accessibilityRole="button"
      accessibilityLabel={`Sync: ${view.label}. Open details`}
      style={[styles.button, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Icon name={view.icon} color={view.color} />
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
