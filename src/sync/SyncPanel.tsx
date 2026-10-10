import { router } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

import { describeSyncState } from './syncState';
import { syncNow, useSyncStatus } from './syncService';

/**
 * Sync status.
 * - compact (Account tab): one tappable row that opens the sync details. No button: sync is
 *   automatic, and pull-to-refresh on the lists covers "check now".
 * - full (sync screen): status, counts and a "Sync now" button for when the user wants to retry
 *   by hand (e.g. after fixing their connection).
 */
export function SyncPanel({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const sync = useSyncStatus();
  const view = describeSyncState(sync, theme);
  if (!view) return null;

  const icon =
    view.icon === 'spinner' ? (
      <ActivityIndicator size="small" color={view.color} />
    ) : (
      <Icon name={view.icon} color={view.color} size={20} />
    );

  if (compact) {
    return (
      <Pressable
        onPress={() => router.push('/sync')}
        accessibilityRole="button"
        accessibilityLabel={`${view.label}. Sync details`}
        style={({ pressed }) => [styles.row, styles.box, { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
      >
        {icon}
        <AppText variant="label" style={styles.grow} color={view.attention ? view.color : theme.text}>
          {view.label}
        </AppText>
        <Icon name="chevronRight" color={theme.muted} size={18} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.box, styles.full, { backgroundColor: theme.surfaceAlt }]}>
      <View style={styles.row}>
        {icon}
        <AppText variant="label" style={styles.grow} color={sync.state === 'error' ? theme.negative : theme.text}>
          {view.label}
        </AppText>
      </View>
      {sync.pendingCount > 0 && sync.state !== 'syncing' && sync.errorCode !== 'OFFLINE' ? (
        <AppText variant="caption" color={theme.muted}>
          {sync.pendingCount === 1 ? '1 change' : `${sync.pendingCount} changes`} waiting to sync.
        </AppText>
      ) : null}
      <AppText variant="caption" color={theme.muted}>
        Sync runs on its own: after you make a change, when you open the app, when you’re back
        online, and when someone else in your groups makes a change.
      </AppText>
      <Button label="Sync now" variant="soft" onPress={() => void syncNow()} busy={sync.state === 'syncing'} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, padding: 12 },
  full: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 24 },
  grow: { flex: 1, minWidth: 0 },
});
