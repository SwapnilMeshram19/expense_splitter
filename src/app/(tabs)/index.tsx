import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getDeviceUserId } from '@/db/session';
import { formatMoney } from '@/domain/currency';
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
import { GradientSurface } from '@/ui/GradientSurface';
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
  const { totals } = overview;
  // Tiles are a light wash over the gradient, so they follow whichever accent is chosen.
  const tile = 'rgba(255,255,255,0.14)';
  const fg = theme.onGradient;
  const settled = totals.length === 0;
  const single = totals.length === 1 ? totals[0]! : null;

  let title: string;
  if (settled) title = 'You’re all settled up';
  else if (!single) title = `Your balances in ${totals.length} currencies`;
  else title = single.net > 0 ? 'Overall, you are owed' : single.net < 0 ? 'Overall, you owe' : 'Overall, you’re even';

  // One line per currency: amounts in different currencies are never added together.
  const owed = totals.filter((x) => x.owedToMe > 0).map((x) => formatMoney(x.owedToMe, x.currency));
  const owe = totals.filter((x) => x.iOwe > 0).map((x) => formatMoney(x.iOwe, x.currency));
  const zero = formatMoney(0, totals[0]?.currency ?? 'INR');
  const heroAmount = single && single.net !== 0 ? formatMoney(Math.abs(single.net), single.currency) : null;

  return (
    <GradientSurface style={styles.balanceCard}>
      <View accessible accessibilityLabel={heroAmount ? `${title} ${heroAmount}` : title}>
        <AppText variant="label" color={fg} style={styles.dim}>
          {title}
        </AppText>
        {heroAmount ? (
          <AppText variant="display" color={fg}>
            {heroAmount}
          </AppText>
        ) : null}
      </View>
      {!settled ? (
        <View style={styles.tiles}>
          <AmountTile label="Owed to you" amounts={owed} zero={zero} background={tile} color={fg} />
          <AmountTile label="You owe" amounts={owe} zero={zero} background={tile} color={fg} />
        </View>
      ) : null}
      {!settled ? (
        <Button
          label="Settle up"
          variant="onGradient"
          size="lg"
          onPress={() => router.navigate('/settle')}
        />
      ) : null}
    </GradientSurface>
  );
}

function AmountTile({
  label,
  amounts,
  zero,
  background,
  color,
}: {
  label: string;
  amounts: string[];
  /** Shown when there's nothing in this direction ("₹0"). */
  zero: string;
  background: string;
  color: string;
}) {
  const shown = amounts.length > 0 ? amounts : [zero];
  return (
    <View
      style={[styles.tile, { backgroundColor: background }]}
      accessible
      accessibilityLabel={`${label}: ${shown.join(' and ')}`}
    >
      <AppText variant="caption" color={color} style={styles.dim}>
        {label}
      </AppText>
      {shown.map((text) => (
        <AppText key={text} variant="amount" color={color} style={styles.tileAmount} numberOfLines={1}>
          {text}
        </AppText>
      ))}
    </View>
  );
}

function GroupRow({ summary, theme }: { summary: GroupSummary; theme: Theme }) {
  const { group, myBalance, lost, me, activeMemberCount } = summary;
  const amount = formatMoney(Math.abs(myBalance), group.currency);
  const balanceLabel = myBalance > 0 ? 'you’re owed' : myBalance < 0 ? 'you owe' : null;
  const balanceColor = myBalance > 0 ? theme.positive : theme.negative;
  const members = activeMemberCount === 1 ? '1 member' : `${activeMemberCount} members`;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/groups/[groupId]', params: { groupId: group.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${balanceLabel ? `${balanceLabel} ${amount}` : 'settled up'}${lost ? ', read-only' : ''}`}
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
              {amount}
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
