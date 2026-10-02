import { FlashList } from '@shopify/flash-list';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { ACTIVITY_PAGE_SIZE, groupActivityQuery } from '@/db/repositories/activity';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { describeActivity, formatTimestamp } from '@/features/activity/describeActivity';
import { useTheme } from '@/ui/theme';

const TABLES = ['activity_log', 'members'];

function loadActivity(groupId: string) {
  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  const names = new Map(groupMembersQuery(db, groupId).all().map((m) => [m.id, m.displayName]));
  const nameOf = (id: string) => names.get(id) ?? 'Someone';
  return groupActivityQuery(db, groupId)
    .all()
    .map((entry) => ({
      id: entry.id,
      ...describeActivity(entry, { me, nameOf }),
      time: formatTimestamp(entry.createdAt),
    }));
}

export default function ActivityScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const compute = useCallback(() => loadActivity(groupId), [groupId]);
  const items = useLiveData(TABLES, compute);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Activity' }} />
      <FlashList
        data={items}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={[styles.empty, { color: theme.muted }]}>No activity yet.</Text>}
        ListFooterComponent={
          items.length >= ACTIVITY_PAGE_SIZE ? (
            <Text style={[styles.empty, { color: theme.muted }]}>Showing the latest {ACTIVITY_PAGE_SIZE} changes.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.text }]}>{item.title}</Text>
            {item.detail ? <Text style={{ color: theme.muted, fontSize: 14 }}>{item.detail}</Text> : null}
            <Text style={{ color: theme.muted, fontSize: 12 }}>{item.time}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { paddingHorizontal: 16, paddingVertical: 12, gap: 3, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 15, fontWeight: '500' },
  empty: { padding: 16, textAlign: 'center' },
});