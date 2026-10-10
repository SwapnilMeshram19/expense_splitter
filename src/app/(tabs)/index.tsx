import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getDeviceUserId } from '@/db/session';
import { formatPaise } from '@/domain/money';
import {
  loadOverview,
  OVERVIEW_TABLES,
  type GroupSummary,
  type Overview,
} from '@/features/overview/loadOverview';
import { useSyncRefreshControl } from '@/sync/useSyncRefreshControl';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { GroupTile } from '@/ui/GroupTile';
import { Greeting, TabHeader } from '@/ui/TabHeader';
import { useTheme, type Theme } from '@/ui/theme';

const loadHome = () => loadOverview(db, getDeviceUserId());

export default function HomeScreen() {
  const theme = useTheme();
  const overview = useLiveData(OVERVIEW_TABLES, loadHome);
  const refreshControl = useSyncRefreshControl();

  return (
    <View style={styles.container}>
      <TabHeader />
      <FlashList
        refreshControl={refreshControl}
        data={overview.groups}
        keyExtractor={(row) => row.group.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          overview.groups.length > 0 ? <ListHeader overview={overview} theme={theme} /> : null
        }
        ListEmptyComponent={<EmptyState />}
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) => <GroupRow summary={item} theme={theme} />}
      />
    </View>
  );
}

function ListHeader({ overview, theme }: { overview: Overview; theme: Theme }) {
  return (
    <View style={styles.headerBlock}>
      <Greeting />
      <BalanceCard overview={overview} theme={theme} />
      <View style={styles.sectionRow}>
        <AppText variant="heading" accessibilityRole="header" style={styles.grow}>
          Your groups
        </AppText>
        <Button
          label="Join"
          variant="secondary"
          onPress={() => router.push('/join')}
          style={styles.smallButton}
        />
        <Button
          label="New"
          icon="add"
          variant="soft"
          onPress={() => router.push('/groups/new')}
          accessibilityLabel="New group"
          style={styles.smallButton}
        />
      </View>
    </View>
  );
}

function BalanceCard({ overview, theme }: { overview: Overview; theme: Theme }) {
  const { net, owedToMe, iOwe } = overview;
  const title =
    net > 0 ? 'Overall, you are owed' : net < 0 ? 'Overall, you owe' : 'You’re all settled up';
  // Tiles tint the card instead of using a second colour: light-on-primary in light mode,
  // dark-on-primary in dark mode (where primary is the lighter shade).
  const tile = theme.scheme === 'light' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';
  const settled = owedToMe === 0 && iOwe === 0;

  return (
    <View style={[styles.balanceCard, { backgroundColor: theme.primary }]}>
      <View
        accessible
        accessibilityLabel={settled ? title : `${title} ${formatPaise(Math.abs(net))}`}
      >
        <AppText variant="label" color={theme.onPrimary} style={styles.dim}>
          {title}
        </AppText>
        {!settled ? (
          <AppText variant="display" color={theme.onPrimary}>
            {formatPaise(Math.abs(net))}
          </AppText>
        ) : null}
      </View>
      {!settled ? (
        <View style={styles.tiles}>
          <View style={[styles.tile, { backgroundColor: tile }]} accessible>
            <AppText variant="caption" color={theme.onPrimary} style={styles.dim}>
              Owed to you
            </AppText>
            <AppText variant="amount" color={theme.onPrimary} style={styles.tileAmount}>
              {formatPaise(owedToMe)}
            </AppText>
          </View>
          <View style={[styles.tile, { backgroundColor: tile }]} accessible>
            <AppText variant="caption" color={theme.onPrimary} style={styles.dim}>
              You owe
            </AppText>
            <AppText variant="amount" color={theme.onPrimary} style={styles.tileAmount}>
              {formatPaise(iOwe)}
            </AppText>
          </View>
        </View>
      ) : null}
      {!settled ? (
        <Button
          label="Settle up"
          variant="highlight"
          size="lg"
          onPress={() => router.navigate('/settle')}
        />
      ) : null}
    </View>
  );
}

function GroupRow({ summary, theme }: { summary: GroupSummary; theme: Theme }) {
  const { group, myBalance, lost, me, activeMemberCount } = summary;
  const balanceLabel = myBalance > 0 ? 'you’re owed' : myBalance < 0 ? 'you owe' : null;
  const balanceColor = myBalance > 0 ? theme.positive : theme.negative;
  const members = activeMemberCount === 1 ? '1 member' : `${activeMemberCount} members`;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/groups/[groupId]', params: { groupId: group.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${balanceLabel ? `${balanceLabel} ${formatPaise(Math.abs(myBalance))}` : 'settled up'}${lost ? ', read-only' : ''}`}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <Card
        style={[
          styles.groupCard,
          lost && { backgroundColor: theme.surfaceAlt, borderStyle: 'dashed' },
        ]}
      >
        <GroupTile groupId={group.id} name={group.name} />
        <View style={styles.grow}>
          <AppText variant="amount" numberOfLines={1}>
            {group.name}
          </AppText>
          {lost ? (
            <View style={[styles.chip, { backgroundColor: theme.warningSoft }]}>
              <AppText variant="caption" color={theme.warning} style={styles.chipText}>
                Read-only · no longer shared
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" color={theme.muted}>
              {me ? members : `${members} · you’re not a member`}
            </AppText>
          )}
        </View>
        {balanceLabel ? (
          <View style={styles.balance}>
            <AppText variant="caption" color={theme.muted}>
              {balanceLabel}
            </AppText>
            <AppText variant="amount" color={balanceColor}>
              {formatPaise(Math.abs(myBalance))}
            </AppText>
          </View>
        ) : (
          <AppText variant="label" color={theme.muted}>
            settled
          </AppText>
        )}
      </Card>
    </Pressable>
  );
}

function EmptyState() {
  const theme = useTheme();
  return (
    <View style={styles.emptyBlock}>
      <Greeting />
      <Card style={styles.empty}>
        <AppText variant="heading" accessibilityRole="header">
          No groups yet
        </AppText>
        <AppText color={theme.muted}>
          Create a group for a trip, your flat, or family expenses, or join one with an invite code.
        </AppText>
        <View style={styles.emptyActions}>
          <Button
            label="New group"
            icon="add"
            onPress={() => router.push('/groups/new')}
            style={styles.grow}
          />
          <Button
            label="Join"
            variant="secondary"
            onPress={() => router.push('/join')}
            style={styles.grow}
          />
        </View>
      </Card>
    </View>
  );
}

const Separator = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  headerBlock: { gap: 16, paddingTop: 4, paddingBottom: 12 },
  balanceCard: { borderRadius: 24, padding: 20, gap: 16 },
  dim: { opacity: 0.88 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  tileAmount: { fontSize: 16 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallButton: { minHeight: 40, paddingHorizontal: 14 },
  grow: { flex: 1, minWidth: 0 },
  groupCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  chipText: { fontWeight: '500' },
  balance: { alignItems: 'flex-end' },
  separator: { height: 10 },
  emptyBlock: { gap: 16, paddingTop: 4 },
  empty: { gap: 10 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
