import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { dataStore } from '@/data';
import { useActivity, useData } from '@/data/hooks';
import { useRefreshControl } from '@/data/useRefreshControl';
import { loadRecentActivity, type RecentActivityItem } from '@/features/activity/loadRecentActivity';
import { AdSlot } from '@/features/ads/AdSlot';
import { isAdRow, withActivityAd } from '@/features/ads/adPolicy';
import { useAdsState } from '@/features/ads/adsRuntime';
import { ScreenGlow } from '@/ui/ScreenGlow';
import { useTabBarSpace } from '@/ui/tabBarSpace';
import { AppText } from '@/ui/AppText';
import { Card } from '@/ui/Card';
import { GroupTile } from '@/ui/GroupTile';
import { TabHeader } from '@/ui/TabHeader';
import { useTheme } from '@/ui/theme';

export default function ActivityTab() {
  const theme = useTheme();
  const tabBarSpace = useTabBarSpace();
  const activity = useActivity(null);
  const items = useData(() => {
    const store = dataStore();
    return loadRecentActivity(activity.entries, store.groups(), store.planningUserId());
  }, [activity.entries]);
  const refreshControl = useRefreshControl();
  // At most one ad, after the 8th entry, and only in long lists.
  const { ready: adsReady } = useAdsState();
  const rows = withActivityAd(items, adsReady);

  return (
    <View style={styles.container}>
      <ScreenGlow />
      <TabHeader title="Activity" />
      <FlashList
        refreshControl={refreshControl}
        data={rows}
        keyExtractor={(row) => row.id}
        getItemType={(row) => (isAdRow(row) ? 'ad' : 'activity')}
        contentContainerStyle={{ ...styles.list, paddingBottom: tabBarSpace }}
        ListEmptyComponent={
          activity.loading ? null : (
            <Card style={styles.empty}>
              <AppText variant="heading">{activity.error ? 'Couldn’t load activity' : 'Nothing here yet'}</AppText>
              <AppText color={theme.muted}>
                {activity.error ? 'Check your connection and pull down to try again.' : 'Changes from all your groups show up here.'}
              </AppText>
            </Card>
          )
        }
        // Older history loads as you scroll.
        onEndReached={activity.more ? activity.loadMore : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          activity.loading ? (
            <AppText variant="caption" color={theme.muted} style={styles.footer}>
              Loading…
            </AppText>
          ) : null
        }
        renderItem={({ item }) =>
          isAdRow(item) ? (
            <AdSlot placement="activity" style={styles.ad} />
          ) : (
            <ActivityRow item={item} />
          )
        }
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
  ad: { marginVertical: 12 },
});
