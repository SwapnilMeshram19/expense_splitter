import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

import { describeIndicator } from './SyncIndicator';
import { syncNow, useSyncStatus, type SyncStatus } from './syncService';

export function describeSync(sync: SyncStatus): string {
  if (sync.state === 'syncing') return 'Syncing…';
  if (sync.state === 'signedOut') return 'Sign in to sync your groups.';
  if (sync.state === 'error' && sync.message) return sync.message;
  if (sync.lastSyncedAt === null) return 'Not synced yet on this phone.';
  const time = new Date(sync.lastSyncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `Last synced at ${time}.`;
}

/**
 * Sync status with a "Sync now" button. `compact` (Account tab) adds a link to the full sync
 * screen when something needs attention; the sync screen itself uses the full variant.
 */
export function SyncPanel({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const sync = useSyncStatus();
  const busy = sync.state === 'syncing';
  const indicator = describeIndicator(sync, theme);

  return (
    <View style={[styles.box, { backgroundColor: theme.surfaceAlt }]}>
      <View style={styles.row}>
        {indicator && indicator.icon !== 'spinner' ? <Icon name={indicator.icon} color={indicator.color} /> : null}
        <AppText variant="label" color={sync.state === 'error' ? theme.negative : theme.text} style={styles.grow}>
          {describeSync(sync)}
        </AppText>
      </View>
      {sync.pendingCount > 0 && sync.state !== 'syncing' ? (
        <AppText variant="caption" color={theme.muted}>
          {sync.pendingCount === 1 ? '1 change' : `${sync.pendingCount} changes`} waiting to sync.
        </AppText>
      ) : null}
      {sync.issueCount > 0 ? (
        <AppText variant="caption" color={theme.warning}>
          {sync.issueCount === 1 ? '1 change needs' : `${sync.issueCount} changes need`} your attention.
        </AppText>
      ) : null}
      <View style={styles.row}>
        <Button
          label="Sync now"
          variant="soft"
          onPress={() => void syncNow()}
          busy={busy}
          style={styles.grow}
        />
        {compact && sync.issueCount > 0 ? (
          <Button label="Review" variant="secondary" onPress={() => router.push('/sync')} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
});
