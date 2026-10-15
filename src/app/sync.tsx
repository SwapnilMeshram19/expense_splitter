import { Stack } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { resolveConflict, type ConflictChoice } from '@/sync/engine';
import { discardLocalChange, loadIssueViews, retryRejectedChange, type IssueView } from '@/sync/issueActions';
import { SyncPanel } from '@/sync/SyncPanel';
import { refreshSyncStatus, syncNow, useSyncStatus } from '@/sync/syncService';
import type { VersionedTable } from '@/sync/wire';
import { useTheme } from '@/ui/theme';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';

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
          <View style={styles.empty}>
            <Icon name="checkCircle" color={theme.positive} size={28} />
            <AppText color={theme.muted}>Nothing needs your attention.</AppText>
          </View>
        ) : (
          <AppText variant="heading" accessibilityRole="header" style={styles.heading}>
            Needs your attention
          </AppText>
        )}

        {views.map((view) => (
          <Card key={view.key} style={styles.card}>
            <AppText variant="heading">{view.title}</AppText>

            {view.issue.kind === 'conflict' ? (
              <>
                <AppText variant="label" color={theme.muted}>
                  Changed on this phone and another one.
                </AppText>
                <Side title="On this phone" lines={view.mine} />
                <Side title="From the other phone" lines={view.theirs ?? ['Downloading… tap Sync now.']} />
                <View style={styles.actions}>
                  <Button label="Keep theirs" onPress={() => keep(view, 'theirs')} style={styles.grow} />
                  <Button label="Keep mine" variant="secondary" onPress={() => keep(view, 'mine')} style={styles.grow} />
                </View>
              </>
            ) : (
              <>
                <AppText variant="label" color={theme.negative}>
                  {view.reason}
                </AppText>
                <Side title="Your change" lines={view.mine} />
                <View style={styles.actions}>
                  <Button label="Try again" icon="cloudSync" onPress={() => retry(view)} style={styles.grow} />
                  {view.canDiscard ? (
                    <Button label="Use server copy" variant="secondary" onPress={() => discard(view)} style={styles.grow} />
                  ) : null}
                </View>
              </>
            )}
          </Card>
        ))}
      </ScrollView>
    </>
  );
}

function Side({ title, lines }: { title: string; lines: string[] }) {
  const theme = useTheme();
  return (
    <View style={[styles.side, { backgroundColor: theme.surfaceAlt }]}>
      <AppText variant="caption" color={theme.muted} style={styles.sideTitle}>
        {title}
      </AppText>
      {lines.map((line, i) => (
        <AppText key={i} variant="label">
          {line}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8, gap: 14, paddingBottom: 48 },
  empty: { alignItems: 'center', gap: 8, marginTop: 24 },
  heading: { marginTop: 8 },
  card: { gap: 10 },
  side: { gap: 2, borderRadius: 12, padding: 12 },
  sideTitle: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  grow: { flex: 1, minWidth: 0 },
});
