import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

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
import { BudgetBar } from '@/ui/BudgetBar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { GradientSurface } from '@/ui/GradientSurface';
import { GroupTile } from '@/ui/GroupTile';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { ScreenGlow } from '@/ui/ScreenGlow';
import { useTabBarSpace } from '@/ui/tabBarSpace';
import { Greeting, TabHeader } from '@/ui/TabHeader';
import { useTheme, type Theme } from '@/ui/theme';

const loadHome = () => loadOverview(db, getDeviceUserId());

type HomeRow = GroupSummary | { heading: 'Settled up' | 'Example' };

/** "≈ ₹3,900" for an amount in another currency, or null. */
type Approx = (minor: number, from: CurrencyCode) => string | null;

export default function HomeScreen() {
  const theme = useTheme();
  const overview = useLiveData(OVERVIEW_TABLES, loadHome);
  const refreshControl = useSyncRefreshControl();
  const tabBarSpace = useTabBarSpace();
  const { homeCurrency } = useRegionPreference();
  // Rates are only fetched when some balance is in a currency other than the home one.
  const approx = useApprox(
    overview.groups.some((g) => g.myBalance !== 0 && g.group.currency !== homeCurrency),
  );

  // Groups where you owe or are owed first; settled ones below their own heading, so what needs
  // doing is always at the top. (Read-only groups stay where they are: they need attention too.)
  // The example group sits on its own at the bottom once a real group exists.
  const real = overview.groups.filter((g) => !g.sample);
  const samples = real.length > 0 ? overview.groups.filter((g) => g.sample) : [];
  const listed = real.length > 0 ? real : overview.groups;
  const open = listed.filter((g) => g.myBalance !== 0 || g.lost);
  const done = listed.filter((g) => g.myBalance === 0 && !g.lost);
  const rows: HomeRow[] = [
    ...open,
    ...(done.length > 0 && open.length > 0 ? [{ heading: 'Settled up' as const }] : []),
    ...done,
    ...(samples.length > 0 ? [{ heading: 'Example' as const }, ...samples] : []),
  ];

  return (
    <View style={styles.container}>
      <ScreenGlow />
      <TabHeader />
      <FlashList
        refreshControl={refreshControl}
        data={rows}
        extraData={approx}
        keyExtractor={(row) => ('heading' in row ? `heading-${row.heading}` : row.group.id)}
        getItemType={(row) => ('heading' in row ? 'heading' : 'group')}
        contentContainerStyle={{ ...styles.list, paddingBottom: tabBarSpace }}
        ListHeaderComponent={
          overview.groups.length > 0 ? (
            <ListHeader overview={overview} theme={theme} approx={approx} />
          ) : null
        }
        ListEmptyComponent={<EmptyState />}
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) =>
          'heading' in item ? (
            <AppText variant="label" color={theme.muted} style={styles.subheading} accessibilityRole="header">
              {item.heading}
            </AppText>
          ) : (
            <GroupRow summary={item} theme={theme} approx={approx} />
          )
        }
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
          icon="link"
          size="sm"
          variant="secondary"
          onPress={() => router.push('/join')}
          accessibilityLabel="Join a group"
        />
        <Button
          label="New"
          icon="add"
          size="sm"
          variant="soft"
          onPress={() => router.push('/groups/new')}
          accessibilityLabel="New group"
        />
      </View>
    </View>
  );
}

/** Calm entrance for the hero and empty state; skipped when the phone asks for reduced motion. */
const ENTER = FadeInDown.duration(380).reduceMotion(ReduceMotion.System);

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
  const fg = theme.onGradient;
  const settled = totals.length === 0;
  const single = totals.length === 1 ? totals[0]! : null;

  let status: string;
  if (settled) status = 'All square';
  else if (!single) status = `${totals.length} currencies`;
  else status = single.net > 0 ? 'You’re owed' : single.net < 0 ? 'You owe' : 'Even';

  // One line per currency: amounts in different currencies are never added together.
  // Each line may carry "≈ ₹3,900" in the home currency; still never summed across currencies.
  const line = (minor: number, currency: CurrencyCode): StatLine => ({
    text: formatMoney(minor, currency),
    approx: approx(minor, currency),
  });
  const owed = totals.filter((x) => x.owedToMe > 0).map((x) => line(x.owedToMe, x.currency));
  const owe = totals.filter((x) => x.iOwe > 0).map((x) => line(x.iOwe, x.currency));
  const zero = formatMoney(0, totals[0]?.currency ?? 'INR');
  const heroAmount = single && single.net !== 0 ? formatMoney(Math.abs(single.net), single.currency) : null;
  const heroApprox = single && single.net !== 0 ? approx(Math.abs(single.net), single.currency) : null;
  const groupCount = overview.groups.length;

  return (
    <Animated.View entering={ENTER}>
      <GradientSurface style={[styles.balanceCard, { borderColor: theme.heroBorder }]}>
        {/* Soft light from the top-left corner: depth without blur or shadow. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.13)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.7, y: 0.7 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View
          accessible
          accessibilityLabel={
            heroAmount
              ? `Net balance: ${status} ${heroAmount}${heroApprox ? `, ${heroApprox}` : ''}`
              : settled
                ? 'You’re all settled up'
                : `Your balances in ${totals.length} currencies`
          }
          style={styles.heroTop}
        >
          <View style={styles.heroLabelRow}>
            <AppText variant="label" color={fg} style={[styles.grow, styles.soft]}>
              Net balance
            </AppText>
            <View style={[styles.statusPill, { borderColor: theme.heroBorder }]}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: settled || !single || single.net >= 0 ? '#9BE7C4' : '#FFB4C0' },
                ]}
              />
              <AppText variant="caption" color={fg} style={styles.pillText}>
                {status}
              </AppText>
            </View>
          </View>
          {heroAmount ? (
            <AppText color={fg} style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
              {heroAmount}
            </AppText>
          ) : settled ? (
            <View style={styles.settledHero}>
              <Icon name="sparkle" color={fg} size={26} />
              <AppText color={fg} style={styles.heroSettled}>
                You’re all settled
              </AppText>
            </View>
          ) : (
            <AppText color={fg} style={styles.heroSettled}>
              Balances by currency
            </AppText>
          )}
          {heroApprox ? (
            <AppText variant="label" color={fg} style={styles.soft}>
              {heroApprox}
            </AppText>
          ) : settled ? (
            <AppText variant="label" color={fg} style={styles.soft}>
              Nothing pending across {groupCount === 1 ? '1 group' : `${groupCount} groups`}.
            </AppText>
          ) : null}
        </View>
        {!settled ? (
          <>
            <View style={[styles.heroRule, { backgroundColor: theme.heroBorder }]} />
            <View style={styles.stats}>
              <Stat label="Owed to you" amounts={owed} zero={zero} color={fg} />
              <View style={[styles.statDivider, { backgroundColor: theme.heroBorder }]} />
              <Stat label="You owe" amounts={owe} zero={zero} color={fg} />
            </View>
            <Button label="Settle up" variant="onGradient" size="lg" onPress={() => router.navigate('/settle')} />
          </>
        ) : null}
      </GradientSurface>
    </Animated.View>
  );
}

interface StatLine {
  text: string;
  approx: string | null;
}

function Stat({
  label,
  amounts,
  zero,
  color,
}: {
  label: string;
  amounts: StatLine[];
  /** Shown when there's nothing in this direction ("₹0"). */
  zero: string;
  color: string;
}) {
  const shown = amounts.length > 0 ? amounts : [{ text: zero, approx: null }];
  return (
    <View
      style={styles.stat}
      accessible
      accessibilityLabel={`${label}: ${shown
        .map((l) => (l.approx ? `${l.text} (${l.approx})` : l.text))
        .join(' and ')}`}
    >
      <AppText variant="caption" color={color} style={styles.soft}>
        {label}
      </AppText>
      {shown.map((l) => (
        <View key={l.text}>
          <AppText variant="amount" color={color} style={styles.statAmount} numberOfLines={1}>
            {l.text}
          </AppText>
          {l.approx ? (
            <AppText variant="caption" color={color} style={styles.soft} numberOfLines={1}>
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
    <PressableScale
      onPress={() => router.push({ pathname: '/groups/[groupId]', params: { groupId: group.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${group.name}, ${balanceLabel ? `${balanceLabel} ${amount}` : 'settled up'}${lost ? ', read-only' : ''}`}
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
          ) : summary.sample ? (
            <View style={styles.sampleLine}>
              <View style={[styles.chip, styles.sampleChip, { backgroundColor: theme.primarySoft }]}>
                <Icon name="sparkle" color={theme.onPrimarySoft} size={12} />
                <AppText variant="caption" color={theme.onPrimarySoft} style={styles.chipText}>
                  Example
                </AppText>
              </View>
              <AppText variant="caption" color={theme.muted}>
                Only on this phone
              </AppText>
            </View>
          ) : (
            <AppText variant="caption" color={theme.muted}>
              {me ? members : `${members} · you’re not a member`}
            </AppText>
          )}
          {summary.budget ? (
            <View style={styles.budget}>
              <BudgetBar status={summary.budget} currency={group.currency} compact />
            </View>
          ) : null}
        </View>
        {balanceLabel ? (
          <View style={styles.balance}>
            <AppText variant="caption" color={theme.muted}>
              {balanceLabel}
            </AppText>
            <AppText variant="amount" color={balanceColor} style={styles.tabular}>
              {amount}
            </AppText>
            {approxAmount ? (
              <AppText variant="caption" color={theme.muted}>
                {approxAmount}
              </AppText>
            ) : null}
          </View>
        ) : (
          <View style={[styles.settledBadge, { backgroundColor: theme.primarySoft }]}>
            <Icon name="checkCircle" color={theme.onPrimarySoft} size={14} />
            <AppText variant="caption" color={theme.onPrimarySoft} style={styles.chipText}>
              Settled
            </AppText>
          </View>
        )}
      </Card>
    </PressableScale>
  );
}

function EmptyState() {
  const theme = useTheme();
  return (
    <Animated.View entering={ENTER} style={styles.emptyBlock}>
      <Greeting />
      <Card style={styles.empty}>
        <GradientSurface style={[styles.emptyIcon, { borderColor: theme.heroBorder }]}>
          <Icon name="groups" color={theme.onGradient} size={28} />
        </GradientSurface>
        <AppText variant="title" accessibilityRole="header" style={styles.centerText}>
          Split anything, calmly
        </AppText>
        <AppText color={theme.muted} style={styles.centerText}>
          Trips, rent, dinners. Add what you spend, see who owes whom, settle by UPI.
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
            icon="link"
            variant="secondary"
            onPress={() => router.push('/join')}
            accessibilityLabel="Join a group"
            style={styles.grow}
          />
        </View>
      </Card>
    </Animated.View>
  );
}

const Separator = () => <View style={styles.separator} />;

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  headerBlock: { gap: 16, paddingTop: 4, paddingBottom: 12 },
  balanceCard: {
    borderRadius: 28,
    padding: 22,
    gap: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  heroTop: { gap: 6 },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  soft: { opacity: 0.78 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontWeight: '600' },
  heroAmount: {
    fontSize: 40,
    lineHeight: 50,
    fontWeight: '700',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  heroSettled: { fontSize: 24, lineHeight: 32, fontWeight: '600', letterSpacing: -0.3 },
  settledHero: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroRule: { height: StyleSheet.hairlineWidth },
  stats: { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  stat: { flex: 1, gap: 2 },
  statDivider: { width: StyleSheet.hairlineWidth },
  statAmount: { fontSize: 17, lineHeight: 24, fontVariant: ['tabular-nums'] },
  tabular: { fontVariant: ['tabular-nums'] },
  centerText: { textAlign: 'center' },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  groupCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22 },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 2,
  },
  chipText: { fontWeight: '500' },
  sampleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  sampleChip: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 0 },
  balance: { alignItems: 'flex-end' },
  budget: { marginTop: 6 },
  separator: { height: 10 },
  subheading: { fontWeight: '600', paddingTop: 10 },
  settledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  emptyBlock: { gap: 16, paddingTop: 4 },
  empty: { gap: 10, paddingVertical: 28, paddingHorizontal: 20 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
});
