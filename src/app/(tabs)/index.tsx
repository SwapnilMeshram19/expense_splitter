import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getDeviceUserId } from '@/db/session';
import { formatMoney, type CurrencyCode } from '@/domain/currency';
import { useApprox } from '@/features/fx/useApprox';
import {
  loadOverview,
  OVERVIEW_TABLES,
  type GroupSummary,
  type Overview,
} from '@/features/overview/loadOverview';
import { useRegionPreference } from '@/features/region/regionPreference';
import { useSyncRefreshControl } from '@/sync/useSyncRefreshControl';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { GradientSurface } from '@/ui/GradientSurface';
import { GroupTile } from '@/ui/GroupTile';
import { Greeting, TabHeader } from '@/ui/TabHeader';
import { useTheme, type Theme } from '@/ui/theme';

const loadHome = () => loadOverview(db, getDeviceUserId());

/** "≈ ₹3,900" for an amount in another currency, or null. */
type Approx = (minor: number, from: CurrencyCode) => string | null;

export default function HomeScreen() {
  const theme = useTheme();
  const overview = useLiveData(OVERVIEW_TABLES, loadHome);
  const refreshControl = useSyncRefreshControl();
  const { homeCurrency } = useRegionPreference();
  // Rates are only fetched when some balance is in a currency other than the home one.
  const approx = useApprox(
    overview.groups.some((g) => g.myBalance !== 0 && g.group.currency !== homeCurrency),
  );

  return (
    <View style={styles.container}>
      <TabHeader />
      <FlashList
        refreshControl={refreshControl}
        data={overview.groups}
        extraData={approx}
        keyExtractor={(row) => row.group.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          overview.groups.length > 0 ? (
            <ListHeader overview={overview} theme={theme} approx={approx} />
          ) : null
        }
        ListEmptyComponent={<EmptyState />}
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) => <GroupRow summary={item} theme={theme} approx={approx} />}
      />
    </View>
  );
}

function ListHeader({
  overview,
  theme,
  approx,
}: {
  overview: Overview;
  theme: Theme;
  approx: Approx;
}) {
  return (
    <View style={styles.headerBlock}>
      <Greeting />
      <BalanceCard overview={overview} theme={theme} approx={approx} />
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

function BalanceCard({
  overview,
  theme,
  approx,
}: {
  overview: Overview;
  theme: Theme;
  approx: Approx;
}) {
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
  // Each line may carry "≈ ₹3,900" in the home currency; still never summed across currencies.
  const line = (minor: number, currency: CurrencyCode): TileLine => ({
    text: formatMoney(minor, currency),
    approx: approx(minor, currency),
  });
  const owed = totals.filter((x) => x.owedToMe > 0).map((x) => line(x.owedToMe, x.currency));
  const owe = totals.filter((x) => x.iOwe > 0).map((x) => line(x.iOwe, x.currency));
  const zero = formatMoney(0, totals[0]?.currency ?? 'INR');
  const heroAmount = single && single.net !== 0 ? formatMoney(Math.abs(single.net), single.currency) : null;
  const heroApprox = single && single.net !== 0 ? approx(Math.abs(single.net), single.currency) : null;

  return (
    <GradientSurface style={styles.balanceCard}>
      <View
        accessible
        accessibilityLabel={
          heroAmount ? `${title} ${heroAmount}${heroApprox ? `, ${heroApprox}` : ''}` : title
        }
      >
        <AppText variant="label" color={fg} style={styles.dim}>
          {title}
        </AppText>
        {heroAmount ? (
          <AppText variant="display" color={fg}>
            {heroAmount}
          </AppText>
        ) : null}
        {heroApprox ? (
          <AppText variant="label" color={fg} style={styles.dim}>
            {heroApprox}
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

interface TileLine {
  text: string;
  approx: string | null;
}

function AmountTile({
  label,
  amounts,
  zero,
  background,
  color,
}: {
  label: string;
  amounts: TileLine[];
  /** Shown when there's nothing in this direction ("₹0"). */
  zero: string;
  background: string;
  color: string;
}) {
  const shown = amounts.length > 0 ? amounts : [{ text: zero, approx: null }];
  return (
    <View
      style={[styles.tile, { backgroundColor: background }]}
      accessible
      accessibilityLabel={`${label}: ${shown
        .map((l) => (l.approx ? `${l.text} (${l.approx})` : l.text))
        .join(' and ')}`}
    >
      <AppText variant="caption" color={color} style={styles.dim}>
        {label}
      </AppText>
      {shown.map((l) => (
        <View key={l.text}>
          <AppText variant="amount" color={color} style={styles.tileAmount} numberOfLines={1}>
            {l.text}
          </AppText>
          {l.approx ? (
            <AppText variant="caption" color={color} style={styles.dim} numberOfLines={1}>
              {l.approx}
            </AppText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function GroupRow({
  summary,
  theme,
  approx,
}: {
  summary: GroupSummary;
  theme: Theme;
  approx: Approx;
}) {
  const { group, myBalance, lost, me, activeMemberCount } = summary;
  const amount = formatMoney(Math.abs(myBalance), group.currency);
  const approxAmount = approx(Math.abs(myBalance), group.currency);
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
            {approxAmount ? (
              <AppText variant="caption" color={theme.muted}>
                {approxAmount}
              </AppText>
            ) : null}
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
