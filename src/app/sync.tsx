import { Stack } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { resolveConflict, type ConflictChoice } from '@/sync/engine';
import { discardLocalChange, loadIssueViews, retryRejectedChange, type IssueView } from '@/sync/issueActions';
import { SyncPanel } from '@/sync/SyncPanel';
import { refreshSyncStatus, syncNow, useSyncStatus } from '@/sync/syncService';
import type { VersionedTable } from '@/sync/wire';
import { useTheme } from '@/ui/theme';
import { Text } from '@/ui/Text';

function afterAction(): void {
  refreshSyncStatus();
  void syncNow();
}

function keep(view: IssueView, choice: ConflictChoice): void {
  const apply = () => {
    const result = resolveConflict(appContext, view.issue.table as VersionedTable, view.issue.id, choice);
    if (!result.ok) {
      Alert.alert(
        'Not resolved yet',
        result.error.code === 'NEEDS_PULL'
          ? 'The other version hasn’t downloaded yet. Syncing now; try again in a moment.'
          : 'This was already resolved.',
      );
    }
    afterAction();
  };

  if (choice === 'theirs') return apply();
  Alert.alert(
    'Keep your version?',
    'This replaces the change made on the other phone, for everyone in the group.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Keep mine', style: 'destructive', onPress: apply },
    ],
  );
}

function retry(view: IssueView): void {
  retryRejectedChange(appContext, view.issue.table, view.issue.id);
  afterAction();
}

function discard(view: IssueView): void {
  Alert.alert('Use the server copy?', 'Your change on this phone will be lost.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Use server copy',
      style: 'destructive',
      onPress: () => {
        discardLocalChange(appContext, view.issue.table as VersionedTable, view.issue.id);
        afterAction();
      },
    },
  ]);
}

export default function SyncScreen() {
  const theme = useTheme();
  // Subscribing re-renders this screen on every sync and every resolve action,
  // which is exactly when the issue list can change.
  useSyncStatus();
  const views = loadIssueViews(appContext); // small synchronous SQLite read

  return (
    <>
      <Stack.Screen options={{ title: 'Sync' }} />
      <ScrollView contentContainerStyle={styles.container}>
        <SyncPanel />

        {views.length === 0 ? (
          <Text style={[styles.empty, { color: theme.muted }]}>Everything on this phone is in sync.</Text>
        ) : (
          <Text style={[styles.heading, { color: theme.text }]}>Needs your attention</Text>
        )}

        {views.map((view) => (
          <View key={view.key} style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>{view.title}</Text>

            {view.issue.kind === 'conflict' ? (
              <>
                <Text style={{ color: theme.muted }}>Changed on this phone and on another phone.</Text>
                <Side title="On this phone" lines={view.mine} />
                <Side
                  title="From the other phone"
                  lines={view.theirs ?? ['Downloading… tap Sync now.']}
                />
                <View style={styles.actions}>
                  <Action label="Keep theirs" onPress={() => keep(view, 'theirs')} primary />
                  <Action label="Keep mine" onPress={() => keep(view, 'mine')} />
                </View>
              </>
            ) : (
              <>
                <Text style={{ color: theme.negative }}>{view.reason}</Text>
                <Side title="Your change" lines={view.mine} />
                <View style={styles.actions}>
                  <Action label="Try again" onPress={() => retry(view)} primary />
                  {view.canDiscard ? <Action label="Use server copy" onPress={() => discard(view)} /> : null}
                </View>
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

function Side({ title, lines }: { title: string; lines: string[] }) {
  const theme = useTheme();
  return (
    <View style={styles.side}>
      <Text style={[styles.sideTitle, { color: theme.muted }]}>{title}</Text>
      {lines.map((line, i) => (
        <Text key={i} style={{ color: theme.text }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function Action({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[
        styles.action,
        primary ? { backgroundColor: theme.primary } : { borderWidth: 1, borderColor: theme.border },
      ]}
    >
      <Text style={{ color: primary ? theme.onPrimary : theme.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  empty: { textAlign: 'center', marginTop: 24 },
  heading: { fontSize: 16, fontWeight: '600', marginTop: 16 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  side: { gap: 2, marginTop: 4 },
  sideTitle: { fontSize: 12, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  action: { flex: 1, borderRadius: 22, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});