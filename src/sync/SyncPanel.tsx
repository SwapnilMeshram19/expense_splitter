import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

import { syncNow, useSyncStatus, type SyncStatus } from './syncService';

function describe(sync: SyncStatus): string {
  if (sync.state === 'syncing') return 'Syncing…';
  if (sync.state === 'signedOut') return 'Sign in to sync your groups.';
  if (sync.state === 'error' && sync.message) return sync.message;
  if (sync.lastSyncedAt === null) return 'Not synced yet on this phone.';
  const time = new Date(sync.lastSyncedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `Last synced at ${time}.`;
}

export function SyncPanel() {
  const theme = useTheme();
  const sync = useSyncStatus();
  const busy = sync.state === 'syncing';

  return (
    <View style={[styles.box, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={[styles.title, { color: theme.text }]}>Sync</Text>
      <Text style={{ color: sync.state === 'error' ? theme.negative : theme.muted }}>{describe(sync)}</Text>
      {sync.pendingCount > 0 && sync.state !== 'syncing' ? (
        <Text style={{ color: theme.muted }}>
          {sync.pendingCount === 1 ? '1 change' : `${sync.pendingCount} changes`} waiting to sync.
        </Text>
      ) : null}
      {sync.issueCount > 0 ? (
        <Text style={{ color: theme.warning }}>
          {sync.issueCount === 1 ? '1 change needs' : `${sync.issueCount} changes need`} your attention.
        </Text>
      ) : null}
      <Pressable
        onPress={() => void syncNow()}
        disabled={busy}
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}
      >
        {busy ? (
          <ActivityIndicator color={theme.onPrimary} />
        ) : (
          <Text style={[styles.buttonText, { color: theme.onPrimary }]}>Sync now</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8, marginTop: 16 },
  title: { fontSize: 16, fontWeight: '600' },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});