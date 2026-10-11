import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getDeviceUserId } from '@/db/session';
import { formatMoney } from '@/domain/currency';
import {
  addMonths,
  computeInsights,
  monthLabel,
  type CategoryTotal,
  type InsightScope,
  type MemberTotal,
  type Period,
  type PeriodSummary,
} from '@/features/insights/compute';
import {
  exportGroup,
  ExportUnavailableError,
  type ExportFormat,
} from '@/features/insights/exportReport';
import { INSIGHTS_TABLES, loadInsightsSource } from '@/features/insights/loadInsights';
import { MonthChart } from '@/features/insights/MonthChart';
import { spendingMessage } from '@/features/share/messages';
import { ShareButtons } from '@/features/share/ShareButtons';
import { todayIsoDate } from '@/lib/dates';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CategoryTile } from '@/ui/CategoryTile';
import { Icon } from '@/ui/Icon';
import { Segmented } from '@/ui/Segmented';
import { useTheme, type Theme } from '@/ui/theme';

const SCOPES: readonly { value: InsightScope; label: string }[] = [
  { value: 'group', label: 'Whole group' },
  { value: 'mine', label: 'My share' },
];

/** Spending by month, category and person for one group, with CSV/PDF export. All on the phone. */
export default function InsightsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const today = todayIsoDate();
  const compute = useCallback(
    () => loadInsightsSource(db, groupId, getDeviceUserId(), todayIsoDate()),
    [groupId],
  );
  const source = useLiveData(INSIGHTS_TABLES, compute);

  const [scopeChoice, setScope] = useState<InsightScope>('group');
  const [period, setPeriod] = useState<Period>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  // "My share" needs a member of mine in this group.
  const scope: InsightScope = source?.me ? scopeChoice : 'group';
  const insights = useMemo(
    () =>
      source
        ? computeInsights(source.expenses, source.members, { scope, me: source.me, period, today })
        : null,
    [source, scope, period, today],
  );

  if (!source || !insights) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Spending' }} />
        <AppText color={theme.muted}>This group no longer exists.</AppText>
      </View>
    );
  }

  const { currency } = source.group;
  const money = (minor: number) => formatMoney(minor, currency);
  const { summary } = insights;
  const periodName = period === null ? 'All time' : monthLabel(period, 'long');
  const monthlyBudget =
    scope === 'group' && source.budget?.period === 'monthly' ? source.budget.limit : null;

  const runExport = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await exportGroup(source, { format, period, today });
    } catch (error) {
      Alert.alert(
        'Could not export',
        error instanceof ExportUnavailableError
          ? 'This phone has no app to share the file with.'
          : 'Something went wrong while making the file. Please try again.',
      );
    } finally {
      setExporting(null);
    }
  };

  if (source.expenses.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Stack.Screen options={{ title: 'Spending' }} />
        <Card style={styles.empty}>
          <Icon name="insights" color={theme.muted} size={28} />
          <AppText color={theme.muted} style={styles.centerText}>
            No expenses yet. Once the group adds some, you’ll see where the money goes here.
          </AppText>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 32 }]}>
      <Stack.Screen options={{ title: 'Spending' }} />

      {source.invalidCount > 0 ? (
        <Banner
          tone="warning"
          title={`${source.invalidCount} expense${source.invalidCount > 1 ? 's' : ''} couldn’t be read`}
          body="Left out here, the same as in the balances."
        />
      ) : null}

      {source.me ? (
        <Segmented
          options={SCOPES}
          value={scope}
          onChange={setScope}
          accessibilityLabel="Whose spending"
        />
      ) : null}

      <Card style={styles.card}>
        <View style={styles.periodRow}>
          <AppText
            variant="label"
            color={theme.muted}
            style={styles.grow}
            accessibilityRole="header"
          >
            {scope === 'group' ? 'Group spent' : 'Your share'} · {periodName}
          </AppText>
          {period !== null ? (
            <Pressable onPress={() => setPeriod(null)} accessibilityRole="button" hitSlop={8}>
              <AppText variant="label" color={theme.primary} style={styles.bold}>
                All time
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <AppText variant="title">{money(summary.total)}</AppText>
        <AppText variant="caption" color={theme.muted}>
          {summaryLine(summary, period, money)}
        </AppText>
        {summary.largest ? (
          <AppText variant="caption" color={theme.muted} numberOfLines={1}>
            Largest: {summary.largest.description} · {money(summary.largest.amount)}
          </AppText>
        ) : null}
        {scope === 'group' && summary.count > 0 ? (
          <ShareButtons
            label="Share summary"
            accessibilityLabel="Share this spending summary on WhatsApp"
            style={styles.shareRow}
            getText={() =>
              spendingMessage({
                groupName: source.group.name,
                currency,
                periodName,
                total: summary.total,
                count: summary.count,
                categories: insights.categories,
              })
            }
          />
        ) : null}
      </Card>

      {insights.months.length > 0 ? (
        <Card style={styles.card}>
          <AppText variant="heading" accessibilityRole="header">
            By month
          </AppText>
          <MonthChart
            months={insights.months}
            currency={currency}
            selected={period}
            onSelect={setPeriod}
            budgetLine={monthlyBudget}
          />
          <AppText variant="caption" color={theme.muted}>
            {period === null
              ? 'Tap a month to see just that month.'
              : 'Tap the month again for all time.'}
          </AppText>
        </Card>
      ) : null}

      <Card style={styles.card}>
        <AppText variant="heading" accessibilityRole="header">
          By category
        </AppText>
        {insights.categories.length === 0 ? (
          <AppText color={theme.muted}>
            {period === null ? 'Nothing spent yet.' : `Nothing spent in ${periodName}.`}
          </AppText>
        ) : (
          insights.categories.map((c) => (
            <CategoryRow key={c.key} item={c} money={money} theme={theme} />
          ))
        )}
      </Card>

      {insights.members.length > 0 ? (
        <Card style={styles.card}>
          <AppText variant="heading" accessibilityRole="header">
            By person
          </AppText>
          <AppText variant="caption" color={theme.muted}>
            Each person’s share of the bills, and what they paid.
          </AppText>
          {insights.members.map((m) => (
            <MemberRow
              key={m.memberId}
              item={m}
              isMe={m.memberId === source.me}
              money={money}
              theme={theme}
            />
          ))}
        </Card>
      ) : null}

      <Card style={styles.card}>
        <AppText variant="heading" accessibilityRole="header">
          {period === null ? 'Export all expenses' : `Export ${periodName}`}
        </AppText>
        <AppText variant="caption" color={theme.muted}>
          Made on this phone and shared from here: nothing is uploaded. The files include names,
          notes and amounts, so share them only with people in the group.
        </AppText>
        <View style={styles.exportRow}>
          <Button
            label="Spreadsheet"
            icon="download"
            variant="secondary"
            busy={exporting === 'csv'}
            disabled={exporting !== null}
            onPress={() => void runExport('csv')}
            style={styles.grow}
            accessibilityLabel="Export as CSV spreadsheet"
          />
          <Button
            label="PDF report"
            icon="share"
            busy={exporting === 'pdf'}
            disabled={exporting !== null}
            onPress={() => void runExport('pdf')}
            style={styles.grow}
            accessibilityLabel="Export as PDF report"
          />
        </View>
      </Card>
    </ScrollView>
  );
}

/** "12 expenses · avg ₹8,400 a month" or "12 expenses · ₹2,000 more than September 2026". */
function summaryLine(
  summary: PeriodSummary,
  period: Period,
  money: (minor: number) => string,
): string {
  const count = `${summary.count} expense${summary.count === 1 ? '' : 's'}`;
  if (summary.monthlyAverage !== null)
    return `${count} · about ${money(summary.monthlyAverage)} a month`;
  if (summary.previousTotal === null || period === null) return count;
  const diff = summary.total - summary.previousTotal;
  const prev = monthLabel(addMonths(period, -1), 'long');
  if (summary.previousTotal === 0) return `${count} · nothing in ${prev}`;
  if (diff === 0) return `${count} · same as ${prev}`;
  return `${count} · ${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than ${prev}`;
}

function CategoryRow({
  item,
  money,
  theme,
}: {
  item: CategoryTotal;
  money: (minor: number) => string;
  theme: Theme;
}) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${item.name}, ${money(item.total)}, ${item.percent} percent, ${item.count} expense${item.count === 1 ? '' : 's'}`}
    >
      <CategoryTile category={item.category} size={36} />
      <View style={styles.grow}>
        <View style={styles.rowTop}>
          <AppText variant="body" style={[styles.medium, styles.grow]} numberOfLines={1}>
            {item.name}
          </AppText>
          <AppText variant="amount">{money(item.total)}</AppText>
        </View>
        <View style={styles.rowTop}>
          <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
            <View
              style={[styles.fill, { width: `${item.percent}%`, backgroundColor: theme.primary }]}
            />
          </View>
          <AppText variant="caption" color={theme.muted} style={styles.pct}>
            {item.percent}%
          </AppText>
        </View>
      </View>
    </View>
  );
}

function MemberRow({
  item,
  isMe,
  money,
  theme,
}: {
  item: MemberTotal;
  isMe: boolean;
  money: (minor: number) => string;
  theme: Theme;
}) {
  const name = `${item.name}${isMe ? ' (you)' : ''}${item.active ? '' : ' (left)'}`;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${name}, share ${money(item.share)}, ${item.percent} percent, paid ${money(item.paid)}`}
    >
      <Avatar seed={item.memberId} name={item.name} size={36} />
      <View style={styles.grow}>
        <View style={styles.rowTop}>
          <AppText variant="body" style={[styles.medium, styles.grow]} numberOfLines={1}>
            {name}
          </AppText>
          <AppText variant="amount">{money(item.share)}</AppText>
        </View>
        <View style={styles.rowTop}>
          <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
            <View
              style={[styles.fill, { width: `${item.percent}%`, backgroundColor: theme.primary }]}
            />
          </View>
          <AppText variant="caption" color={theme.muted} style={styles.pct}>
            {item.percent}%
          </AppText>
        </View>
        <AppText variant="caption" color={theme.muted}>
          Paid {money(item.paid)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  card: { gap: 10 },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  medium: { fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  pct: { width: 36, textAlign: 'right' },
  exportRow: { flexDirection: 'row', gap: 10 },
  shareRow: { marginTop: 6 },
});
