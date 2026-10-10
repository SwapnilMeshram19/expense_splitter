import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { deleteSettlement } from '@/db/repositories/settlements';
import type { Settlement } from '@/db/schema';
import { getDeviceUserId } from '@/db/session';
import type { Debt } from '@/domain/balances';
import { formatPaise } from '@/domain/money';
import { describeMyExpenseShare } from '@/features/balances/describe';
import {
  GROUP_VIEW_TABLES,
  loadGroupView,
  type ActivityRow,
  type GroupView,
  type HistoryRow,
} from '@/features/groups/loadGroupView';
import { LostAccessBanner } from '@/features/groups/LostAccessBanner';
import { describeSettlementError, METHOD_LABELS } from '@/features/settlements/messages';
import { PendingUpiBanner } from '@/features/upi/PendingUpiBanner';
import { todayIsoDate } from '@/lib/dates';
import { useSyncRefreshControl } from '@/sync/useSyncRefreshControl';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CategoryTile } from '@/ui/CategoryTile';
import { HeaderIconButton } from '@/ui/HeaderIconButton';
import { Icon } from '@/ui/Icon';
import { Segmented } from '@/ui/Segmented';
import { toneColor, useTheme, type Theme } from '@/ui/theme';

type Segment = 'expenses' | 'balances' | 'activity';
const SEGMENTS: readonly { value: Segment; label: string }[] = [
  { value: 'expenses', label: 'Expenses' },
  { value: 'balances', label: 'Balances' },
  { value: 'activity', label: 'Activity' },
];

/** One list, three segments: rows are tagged so FlashList recycles each kind separately. */
type Row =
  | HistoryRow
  | { kind: 'section'; key: string; title: string }
  | { kind: 'transfer'; key: string; debt: Debt }
  | { kind: 'record'; key: string }
  | { kind: 'balance'; key: string; memberId: string; balance: number }
  | { kind: 'activity'; key: string; item: ActivityRow }
  | { kind: 'empty'; key: string; text: string };

function rowsFor(segment: Segment, view: GroupView): Row[] {
  if (segment === 'expenses') {
    if (view.history.length > 0) return view.history;
    return [
      {
        kind: 'empty',
        key: 'empty',
        text: view.canEdit ? 'No expenses yet. Tap “Add expense” to add the first one.' : 'No expenses yet.',
      },
    ];
  }
  if (segment === 'activity') {
    if (view.activity.length === 0) return [{ kind: 'empty', key: 'empty', text: 'No activity yet.' }];
    return view.activity.map((item) => ({ kind: 'activity' as const, key: item.key, item }));
  }
  const rows: Row[] = [
    {
      kind: 'section',
      key: 'sec-pay',
      title: view.group.simplifyDebts ? 'Suggested payments' : 'Who owes whom',
    },
  ];
  if (view.transfers.length === 0) rows.push({ kind: 'empty', key: 'no-transfers', text: 'Everyone is settled up.' });
  for (const debt of view.transfers) {
    rows.push({ kind: 'transfer', key: `t-${debt.fromMemberId}-${debt.toMemberId}`, debt });
  }
  if (view.canEdit) rows.push({ kind: 'record', key: 'record' });
  rows.push({ kind: 'section', key: 'sec-bal', title: 'Balances' });
  for (const m of view.memberBalances) rows.push({ kind: 'balance', key: `b-${m.id}`, memberId: m.id, balance: m.balance });
  return rows;
}

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>('expenses');
  const compute = useCallback(() => loadGroupView(db, groupId, getDeviceUserId(), todayIsoDate()), [groupId]);
  const view = useLiveData(GROUP_VIEW_TABLES, compute);
  const refreshControl = useSyncRefreshControl();

  if (!view) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Group' }} />
        <AppText color={theme.muted}>This group no longer exists.</AppText>
      </View>
    );
  }

  const { me, canEdit } = view;
  const nameOf = (id: string) => (id === me ? 'You' : (view.names.get(id) ?? 'Unknown member'));

  const openSettle = (params: { from?: string; to?: string; amount?: string } = {}) =>
    router.push({ pathname: '/groups/[groupId]/settle', params: { groupId, ...params } });
  const openPay = (toMemberId: string, amountPaise: number) =>
    router.push({ pathname: '/groups/[groupId]/pay', params: { groupId, to: toMemberId, amount: String(amountPaise) } });
  const openRequest = (fromMemberId: string, amountPaise: number) =>
    router.push({
      pathname: '/groups/[groupId]/request',
      params: { groupId, from: fromMemberId, amount: String(amountPaise) },
    });

  const confirmDeleteSettlement = (settlement: Settlement) => {
    if (!canEdit || !me) return;
    Alert.alert(
      'Delete this payment?',
      `${nameOf(settlement.fromMemberId)} → ${nameOf(settlement.toMemberId)}, ${formatPaise(settlement.amountPaise)}. Balances will go back to how they were before it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const result = deleteSettlement(appContext, settlement.id, me);
            if (!result.ok) Alert.alert('Could not delete', describeSettlementError(result.error, nameOf));
          },
        },
      ],
    );
  };

  const header = (
    <View style={styles.header}>
      {view.lost ? <LostAccessBanner groupId={groupId} groupName={view.group.name} /> : null}
      {!me && !view.lost ? (
        <Banner
          tone="warning"
          title="You’re not a member of this group"
          body="You can’t add expenses here. Open group settings to delete it from this phone."
        />
      ) : null}
      {canEdit ? <PendingUpiBanner groupId={groupId} nameOf={nameOf} /> : null}
      <SummaryCard view={view} theme={theme} nameOf={nameOf} onSettle={() => setSegment('balances')} onRecord={() => openSettle()} />
      {view.invalidCount > 0 ? (
        <Banner
          tone="warning"
          title={`${view.invalidCount} record${view.invalidCount > 1 ? 's' : ''} couldn’t be read`}
          body={`${view.invalidCount > 1 ? 'They are' : 'It is'} left out of the balances.`}
        />
      ) : null}
      <Segmented options={SEGMENTS} value={segment} onChange={setSegment} accessibilityLabel="Group view" />
    </View>
  );

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.kind) {
      case 'date':
        return (
          <AppText variant="caption" color={theme.muted} style={styles.dateHeader} accessibilityRole="header">
            {item.label.toUpperCase()}
          </AppText>
        );
      case 'expense': {
        const share = describeMyExpenseShare(item.myNet, item.involved);
        const [shareLabel, shareAmount] = splitShareLabel(share.label);
        const firstPayer = item.payers[0];
        const paidBy =
          item.payers.length === 1 && firstPayer
            ? `${nameOf(firstPayer.memberId)} paid ${formatPaise(item.expense.amountPaise)}`
            : `${item.payers.length} people paid ${formatPaise(item.expense.amountPaise)}`;
        return (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/groups/[groupId]/expenses/[expenseId]',
                params: { groupId, expenseId: item.expense.id },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`${item.expense.description}, ${paidBy}, ${share.label}`}
            style={({ pressed }) => [styles.historyRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <CategoryTile category={item.expense.category} />
            <View style={styles.grow}>
              <AppText variant="body" style={styles.medium} numberOfLines={1}>
                {item.expense.description}
              </AppText>
              <AppText variant="caption" color={theme.muted} numberOfLines={1}>
                {item.expense.categoryLabel ? `${item.expense.categoryLabel} · ${paidBy}` : paidBy}
              </AppText>
            </View>
            <View style={styles.right}>
              <AppText variant="caption" color={theme.muted}>
                {shareLabel}
              </AppText>
              {shareAmount ? (
                <AppText variant="label" color={toneColor(theme, share.tone)} style={styles.bold}>
                  {shareAmount}
                </AppText>
              ) : null}
            </View>
          </Pressable>
        );
      }
      case 'settlement': {
        const s = item.settlement;
        const text =
          s.fromMemberId === me
            ? `You paid ${nameOf(s.toMemberId)}`
            : s.toMemberId === me
              ? `${nameOf(s.fromMemberId)} paid you`
              : `${nameOf(s.fromMemberId)} paid ${nameOf(s.toMemberId)}`;
        return (
          <Pressable
            disabled={!canEdit}
            onPress={() => confirmDeleteSettlement(s)}
            accessibilityRole="button"
            accessibilityHint={canEdit ? 'Opens the option to delete this payment' : undefined}
            style={({ pressed }) => [styles.settlementRow, { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 }]}
          >
            <Icon name="settle" color={theme.onPrimarySoft} size={20} />
            <View style={styles.grow}>
              <AppText variant="label" color={theme.onPrimarySoft} numberOfLines={1}>
                {text}
              </AppText>
              <AppText variant="caption" color={theme.onPrimarySoft} numberOfLines={1}>
                {METHOD_LABELS[s.method]}
                {s.note ? ` · ${s.note}` : ''}
              </AppText>
            </View>
            <AppText variant="amount" color={theme.onPrimarySoft}>
              {formatPaise(s.amountPaise)}
            </AppText>
          </Pressable>
        );
      }
      case 'section':
        return (
          <AppText variant="heading" accessibilityRole="header" style={styles.section}>
            {item.title}
          </AppText>
        );
      case 'transfer':
        return (
          <TransferRow
            debt={item.debt}
            me={me}
            canEdit={canEdit}
            nameOf={nameOf}
            theme={theme}
            onRecord={() =>
              openSettle({ from: item.debt.fromMemberId, to: item.debt.toMemberId, amount: String(item.debt.amountPaise) })
            }
            onPay={() => openPay(item.debt.toMemberId, item.debt.amountPaise)}
            onRequest={() => openRequest(item.debt.fromMemberId, item.debt.amountPaise)}
          />
        );
      case 'record':
        return (
          <Button label="Record a payment" variant="secondary" icon="add" onPress={() => openSettle()} style={styles.recordButton} />
        );
      case 'balance': {
        const tone = item.balance > 0 ? 'positive' : item.balance < 0 ? 'negative' : 'neutral';
        const isMe = item.memberId === me;
        return (
          <View style={styles.balanceRow}>
            <Avatar seed={item.memberId} name={view.names.get(item.memberId)} size={32} />
            <AppText style={styles.grow} numberOfLines={1}>
              {isMe ? `${view.names.get(item.memberId) ?? 'You'} (you)` : nameOf(item.memberId)}
            </AppText>
            <AppText variant="label" color={toneColor(theme, tone)} style={styles.bold}>
              {item.balance === 0
                ? 'settled'
                : `${item.balance > 0 ? 'gets back' : 'owes'} ${formatPaise(Math.abs(item.balance))}`}
            </AppText>
          </View>
        );
      }
      case 'activity':
        return (
          <View style={[styles.activityRow, { borderBottomColor: theme.border }]}>
            <AppText variant="body" style={styles.medium}>
              {item.item.title}
            </AppText>
            {item.item.detail ? (
              <AppText variant="label" color={theme.muted}>
                {item.item.detail}
              </AppText>
            ) : null}
            <AppText variant="caption" color={theme.muted}>
              {item.item.time}
            </AppText>
          </View>
        );
      case 'empty':
        return (
          <AppText color={theme.muted} style={styles.emptyText}>
            {item.text}
          </AppText>
        );
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: view.group.name,
          headerRight: () => (
            <View style={styles.headerActions}>
              {canEdit ? (
                <HeaderIconButton
                  icon="personAdd"
                  label="Invite members"
                  onPress={() => router.push({ pathname: '/groups/[groupId]/invite', params: { groupId } })}
                />
              ) : null}
              <HeaderIconButton
                icon="settings"
                label="Group settings"
                onPress={() => router.push({ pathname: '/groups/[groupId]/settings', params: { groupId } })}
              />
            </View>
          ),
        }}
      />
      <FlashList
        refreshControl={refreshControl}
        data={rowsFor(segment, view)}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 104 }}
        renderItem={renderRow}
      />

      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add expense"
          onPress={() => router.push({ pathname: '/groups/[groupId]/expenses/new', params: { groupId } })}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: theme.primary, bottom: insets.bottom + 24, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Icon name="add" color={theme.onPrimary} size={22} />
          <AppText variant="label" color={theme.onPrimary} style={styles.fabText}>
            Add expense
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/** "you lent ₹600" → ["you lent", "₹600"]; labels without an amount stay whole. */
function splitShareLabel(label: string): [string, string | null] {
  const index = label.indexOf('₹');
  return index > 0 ? [label.slice(0, index).trim(), label.slice(index)] : [label, null];
}

function SummaryCard({
  view,
  theme,
  nameOf,
  onSettle,
  onRecord,
}: {
  view: GroupView;
  theme: Theme;
  nameOf: (id: string) => string;
  onSettle: () => void;
  onRecord: () => void;
}) {
  const { myBalance, me, transfers, activeMembers } = view;
  const title =
    myBalance > 0 ? 'You’re owed in this group' : myBalance < 0 ? 'You owe in this group' : 'You’re settled up here';
  const mine = transfers.filter((t) => t.fromMemberId === me || t.toMemberId === me).slice(0, 3);
  const stack = activeMembers.slice(0, 3);
  const extra = activeMembers.length - stack.length;

  return (
    <Card style={styles.summary}>
      <View style={styles.summaryTop}>
        <View style={styles.grow} accessible>
          <AppText variant="label" color={theme.muted}>
            {title}
          </AppText>
          {myBalance !== 0 ? (
            <AppText variant="title" color={myBalance > 0 ? theme.positive : theme.negative}>
              {formatPaise(Math.abs(myBalance))}
            </AppText>
          ) : null}
        </View>
        <View
          style={styles.avatarStack}
          accessible
          accessibilityLabel={`${activeMembers.length} member${activeMembers.length === 1 ? '' : 's'}`}
        >
          {stack.map((m, index) => (
            <View key={m.id} style={index > 0 ? styles.overlap : undefined}>
              <Avatar seed={m.id} name={m.name} size={32} ring />
            </View>
          ))}
          {extra > 0 ? (
            <View style={[styles.overlap, styles.more, { backgroundColor: theme.surfaceAlt, borderColor: theme.surface }]}>
              <AppText variant="caption" style={styles.bold}>
                +{extra}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>

      {mine.length > 0 ? (
        <View style={styles.lines}>
          {mine.map((t) => {
            const owesMe = t.toMemberId === me;
            return (
              <View key={`${t.fromMemberId}-${t.toMemberId}`} style={styles.line}>
                <AppText variant="label" color={theme.muted} style={styles.grow} numberOfLines={1}>
                  {owesMe ? `${nameOf(t.fromMemberId)} owes you` : `You owe ${nameOf(t.toMemberId)}`}
                </AppText>
                <AppText variant="label" color={owesMe ? theme.positive : theme.negative} style={styles.bold}>
                  {formatPaise(t.amountPaise)}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}

      {view.canEdit && transfers.length > 0 ? (
        <View style={styles.summaryActions}>
          <Button label="Settle up" onPress={onSettle} style={styles.grow} />
          <Button label="Record payment" variant="secondary" onPress={onRecord} style={styles.grow} />
        </View>
      ) : null}
    </Card>
  );
}

function TransferRow({
  debt: t,
  me,
  canEdit,
  nameOf,
  theme,
  onRecord,
  onPay,
  onRequest,
}: {
  debt: Debt;
  me: string | null;
  canEdit: boolean;
  nameOf: (id: string) => string;
  theme: Theme;
  onRecord: () => void;
  onPay: () => void;
  onRequest: () => void;
}) {
  const iPay = t.fromMemberId === me;
  const iReceive = t.toMemberId === me;
  const sentence = `${nameOf(t.fromMemberId)} ${iPay ? 'pay' : 'pays'} ${iReceive ? 'you' : nameOf(t.toMemberId)}`;
  const amountColor = iPay ? theme.negative : iReceive ? theme.positive : theme.text;

  return (
    <Card style={styles.transferCard}>
      <View style={styles.transferTop}>
        <Avatar seed={t.fromMemberId} name={nameOf(t.fromMemberId)} size={32} />
        <Icon name="arrowForward" color={theme.muted} size={16} />
        <Avatar seed={t.toMemberId} name={nameOf(t.toMemberId)} size={32} />
        <AppText variant="label" style={styles.grow} numberOfLines={2}>
          {sentence}
        </AppText>
        <AppText variant="amount" color={amountColor}>
          {formatPaise(t.amountPaise)}
        </AppText>
      </View>
      {canEdit ? (
        <View style={styles.transferActions}>
          {iPay ? (
            <Button
              label="Pay with UPI"
              icon="arrowForward"
              onPress={onPay}
              style={styles.grow}
              accessibilityLabel={`Pay ${nameOf(t.toMemberId)} with UPI`}
            />
          ) : iReceive ? (
            <Button
              label="Request"
              variant="soft"
              onPress={onRequest}
              style={styles.grow}
              accessibilityLabel={`Get paid by ${nameOf(t.fromMemberId)}`}
            />
          ) : null}
          <Button
            label={iPay || iReceive ? 'Record' : 'Record payment'}
            variant="secondary"
            onPress={onRecord}
            style={iPay || iReceive ? undefined : styles.grow}
            accessibilityLabel={`Record payment from ${nameOf(t.fromMemberId)} to ${nameOf(t.toMemberId)}`}
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { gap: 14, paddingTop: 4, paddingBottom: 8 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  medium: { fontWeight: '500' },
  bold: { fontWeight: '600' },
  right: { alignItems: 'flex-end' },
  summary: { gap: 12 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarStack: { flexDirection: 'row', alignItems: 'center' },
  overlap: { marginLeft: -10 },
  more: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  lines: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryActions: { flexDirection: 'row', gap: 10 },
  dateHeader: { fontWeight: '600', letterSpacing: 0.4, paddingTop: 14, paddingBottom: 4 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginVertical: 4,
  },
  section: { paddingTop: 14, paddingBottom: 8 },
  transferCard: { gap: 10, padding: 14, borderRadius: 18, marginBottom: 10 },
  transferTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  transferActions: { flexDirection: 'row', gap: 8 },
  recordButton: { marginBottom: 4 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  activityRow: { paddingVertical: 12, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  emptyText: { paddingVertical: 12 },
  fab: {
    position: 'absolute',
    right: 20,
    minHeight: 56,
    paddingLeft: 18,
    paddingRight: 22,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 4,
  },
  fabText: { fontSize: 15, fontWeight: '600' },
});
