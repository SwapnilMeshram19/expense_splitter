import { Stack } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { dataStore } from '@/data';
import { useData, useDataStatus } from '@/data/hooks';
import { refreshNow } from '@/data/native';
import { formatTimestamp } from '@/features/activity/describeActivity';
import { pendingReason, pendingTitle } from '@/features/data/describePending';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

/**
 * Changes made on this phone that aren't on the server: waiting for a connection (they send on
 * their own) or refused by the server (try again after fixing it, or discard).
 */
export default function PendingScreen() {
  const theme = useTheme();
  const status = useDataStatus();
  const ops = useData(() => {
    const store = dataStore();
    return store.pendingOps().map((op) => {
      const group = store.group(op.groupId)?.group;
      return { op, groupName: group?.name ?? null, currency: group?.currency ?? 'INR' };
    });
  });

  const discard = (requestId: string) =>
    Alert.alert('Discard this change?', 'It was never saved, so nobody else has it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => dataStore().discardOp(requestId) },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: 'Not saved yet' }} />
      <ScrollView contentContainerStyle={styles.container}>
        {ops.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="cloudDone" color={theme.positive} size={28} />
            <AppText color={theme.muted}>Everything is saved.</AppText>
          </View>
        ) : null}

        {ops.map(({ op, groupName, currency }) => (
          <Card key={op.requestId} style={styles.card}>
            <AppText variant="heading">{pendingTitle(op.cmd, currency)}</AppText>
            <AppText variant="caption" color={theme.muted}>
              {groupName ? `${groupName} · ` : ''}
              {formatTimestamp(op.at)}
            </AppText>
            <AppText variant="label" color={op.status === 'failed' ? theme.negative : theme.muted}>
              {pendingReason(op)}
            </AppText>
            {op.status === 'failed' ? (
              <View style={styles.actions}>
                <Button label="Try again" icon="cloudSync" onPress={() => dataStore().retryOp(op.requestId)} style={styles.grow} />
                <Button label="Discard" variant="secondary" onPress={() => discard(op.requestId)} style={styles.grow} />
              </View>
            ) : null}
          </Card>
        ))}

        {status.queued > 0 ? (
          <Button label="Send now" variant="soft" icon="cloudUpload" onPress={() => void refreshNow()} />
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8, gap: 14, paddingBottom: 48 },
  empty: { alignItems: 'center', gap: 8, marginTop: 24 },
  card: { gap: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  grow: { flex: 1, minWidth: 0 },
});
