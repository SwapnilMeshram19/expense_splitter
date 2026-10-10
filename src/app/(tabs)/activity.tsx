import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { ACTIVITY_PAGE_SIZE } from '@/db/repositories/activity';
import { getDeviceUserId } from '@/db/session';
import {
  loadRecentActivity,
  RECENT_ACTIVITY_TABLES,
  type RecentActivityItem,
} from '@/features/activity/loadRecentActivity';
import { useSyncRefreshControl } from '@/sync/useSyncRefreshControl';
import { AppText } from '@/ui/AppText';
import { Card } from '@/ui/Card';
import { GroupTile } from '@/ui/GroupTile';
import { TabHeader } from '@/ui/TabHeader';
import { useTheme } from '@/ui/theme';

const load = () => loadRecentActivity(db, getDeviceUserId());

export default function ActivityTab() {
  const theme = useTheme();
  const items = useLiveData(RECENT_ACTIVITY_TABLES, load);
  const refreshControl = useSyncRefreshControl();

  return (
    <View style={styles.container}>
      <TabHeader title="Activity" />
      <FlashList
        refreshControl={refreshControl}
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Card style={styles.empty}>
            <AppText variant="heading">Nothing here yet</AppText>
            <AppText color={theme.muted}>
              Expenses, payments and member changes from all your groups show up here.
            </AppText>
          </Card>
        }
        ListFooterComponent={
          items.length >= ACTIVITY_PAGE_SIZE ? (
            <AppText variant="caption" color={theme.muted} style={styles.footer}>
              Showing the latest {ACTIVITY_PAGE_SIZE} changes. Open a group for its full history.
            </AppText>
          ) : null
        }
        renderItem={({ item }) => <ActivityRow item={item} />}
      />
    </View>
  );
}

function ActivityRow({ item }: { item: RecentActivityItem }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/groups/[groupId]', params: { groupId: item.groupId } })}
      accessibilityRole="button"
      accessibilityHint={`Opens ${item.groupName}`}
      style={({ pressed }) => [styles.row, { borderBottomColor: theme.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <GroupTile groupId={item.groupId} name={item.groupName} size={40} />
      <View style={styles.grow}>
        <AppText variant="body" style={styles.title}>
          {item.title}
        </AppText>
        {item.detail ? (
          <AppText variant="label" color={theme.muted}>
            {item.detail}
          </AppText>
        ) : null}
        <AppText variant="caption" color={theme.muted}>
          {item.groupName} · {item.time}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontWeight: '500' },
  empty: { gap: 8, marginTop: 8 },
  footer: { textAlign: 'center', paddingVertical: 16 },
});
