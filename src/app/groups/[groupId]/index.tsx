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
import { formatMoney } from '@/domain/currency';
import { describeMyExpenseShare } from '@/features/balances/describe';
import { useApprox } from '@/features/fx/useApprox';
import {
  GROUP_VIEW_TABLES,
  loadGroupView,
  type ActivityRow,
  type GroupView,
  type HistoryRow,
  type SettledPart,
} from '@/features/groups/loadGroupView';
import { LostAccessBanner } from '@/features/groups/LostAccessBanner';
import { describeSettlementError, METHOD_LABELS } from '@/features/settlements/messages';
import { balancesMessage } from '@/features/share/messages';
import { ShareButtons } from '@/features/share/ShareButtons';
import { useShareSheet } from '@/features/share/ShareSheet';
import { PendingUpiBanner } from '@/features/upi/PendingUpiBanner';
import { todayIsoDate } from '@/lib/dates';
import { useSyncRefreshControl } from '@/sync/useSyncRefreshControl';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { BudgetBar } from '@/ui/BudgetBar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CategoryTile } from '@/ui/CategoryTile';
import { GradientSurface } from '@/ui/GradientSurface';
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
  | { kind: 'share'; key: string }
  | { kind: 'balance'; key: string; memberId: string; balance: number }
  | { kind: 'activity'; key: string; item: ActivityRow }
  | { kind: 'settledMarker'; key: string }
  /** A row from before the last settle-up, shown faded when the settled part is expanded. */
  | { kind: 'past'; key: string; row: HistoryRow }
  | { kind: 'empty'; key: string; text: string };

function rowsFor(segment: Segment, view: GroupView, showSettled: boolean): Row[] {
  if (segment === 'expenses') {
    const rows: Row[] = [...view.history];
    if (view.settled) {
      rows.push({ kind: 'settledMarker', key: 'settled-marker' });
      if (showSettled) rows.push(...view.settled.history.map((row) => ({ kind: 'past' as const, key: `p-${row.key}`, row })));
    }
    if (rows.length > 0) return rows;
    return [
      {
        kind: 'empty',
        key: 'empty',
        text: view.canEdit ? 'No expenses yet. Tap Add expense to start.' : 'No expenses yet.',
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
  if (view.expenseCount > 0) rows.push({ kind: 'share', key: 'share' });
  rows.push({ kind: 'section', key: 'sec-bal', title: 'Balances' });
  for (const m of view.memberBalances) rows.push({ kind: 'balance', key: `b-${m.id}`, memberId: m.id, balance: m.balance });
  return rows;
}

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>('expenses');
  const [showSettled, setShowSettled] = useState(false);
  const compute = useCallback(() => loadGroupView(db, groupId, getDeviceUserId(), todayIsoDate()), [groupId]);
  const view = useLiveData(GROUP_VIEW_TABLES, compute);
  const refreshControl = useSyncRefreshControl();
  // "≈ in your currency" under my balance when this group uses another currency.
  const approx = useApprox(!!view && view.myBalance !== 0);
  const share = useShareSheet();

  if (!view) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Group' }} />
        <AppText color={theme.muted}>This group no longer exists.</AppText>
      </View>
    );
  }

  const { me, canEdit } = view;
  const { currency } = view.group;
  const money = (minor: number) => formatMoney(minor, currency);
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

  const openInvite = () => router.push({ pathname: '/groups/[groupId]/invite', params: { groupId } });

  const balancesText = () =>
    balancesMessage({
      groupName: view.group.name,
      currency,
      transfers: view.transfers,
      names: view.names,
      upiIds: view.upiIds,
      totalSpent: view.totalSpent,
      expenseCount: view.expenseCount,
    });

  const openShare = () =>
    share.open({
      title: 'Share balances',
      getText: balancesText,
      actions: [
        ...(canEdit ? [{ icon: 'personAdd' as const, label: 'Invite people', onPress: openInvite }] : []),
        {
          icon: 'insights' as const,
          label: 'Share spending summary',
          onPress: () => router.push({ pathname: '/groups/[groupId]/insights', params: { groupId } }),
        },
      ],
    });

  const confirmDeleteSettlement = (settlement: Settlement) => {
    if (!canEdit || !me) return;
    Alert.alert(
      'Delete this payment?',
      `${nameOf(settlement.fromMemberId)} → ${nameOf(settlement.toMemberId)}, ${money(settlement.amountPaise)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const result = deleteSettlement(appContext, settlement.id, me);
            if (!result.ok) {
              Alert.alert('Could not delete', describeSettlementError(result.error, nameOf, currency));
            }
          },
        },
      ],
    );
  };

  const header = (
    <View style={styles.header}>
      {view.lost ? <LostAccessBanner groupId={groupId} groupName={view.group.name} /> : null}
      {!me && !view.lost ? (
        <Banner tone="warning" title="You’re not in this group" body="Read-only on this phone." />
      ) : null}
      {canEdit ? <PendingUpiBanner groupId={groupId} nameOf={nameOf} /> : null}
      <SummaryCard
        view={view}
        theme={theme}
        nameOf={nameOf}
        money={money}
        approx={approx(Math.abs(view.myBalance), currency)}
        onSettle={() => setSegment('balances')}
        onShare={openShare}
        onInvite={canEdit ? openInvite : undefined}
      />
      {view.invalidCount > 0 ? (
        <Banner
          tone="warning"
          title={`${view.invalidCount} record${view.invalidCount > 1 ? 's' : ''} couldn’t be read`}
          body="Left out of the balances."
        />
      ) : null}
      <Segmented options={SEGMENTS} value={segment} onChange={setSegment} accessibilityLabel="Group view" />
    </View>
  );

  const renderRow = ({ item }: { item: Row }): React.ReactElement | null => {
    switch (item.kind) {
      case 'settledMarker':
        return view.settled ? (
          <SettledMarker
            settled={view.settled}
            money={money}
            open={showSettled}
            onToggle={() => setShowSettled((v) => !v)}
            theme={theme}
          />
        ) : null;
      case 'past':
        return <View style={styles.past}>{renderRow({ item: item.row })}</View>;
      case 'date':
        return (
          <AppText variant="caption" color={theme.muted} style={styles.dateHeader} accessibilityRole="header">
            {item.label.toUpperCase()}
          </AppText>
        );
      case 'expense': {
        const share = describeMyExpenseShare(item.myNet, item.involved, currency);
        const firstPayer = item.payers[0];
        const { expense } = item;
        // A foreign bill reads in the currency it was paid in, with the group amount alongside.
        const total =
          expense.originalCurrency && expense.originalAmountMinor !== null
            ? `${formatMoney(expense.originalAmountMinor, expense.originalCurrency)} (${money(expense.amountPaise)})`
            : money(expense.amountPaise);
        const paidBy =
          item.payers.length === 1 && firstPayer
            ? `${nameOf(firstPayer.memberId)} paid ${total}`
            : `${item.payers.length} people paid ${total}`;
        return (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/groups/[groupId]/expenses/[expenseId]',
                params: { groupId, expenseId: item.expense.id },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={`${item.expense.description}, ${paidBy}, ${share.label}${item.expense.note ? ', has a note' : ''}${item.expense.receiptId ? ', has a receipt' : ''}${item.expense.recurringRuleId ? ', repeats' : ''}`}
            style={({ pressed }) => [styles.historyRow, { opacity: pressed ? 0.7 : 1 }]}
          >
            <CategoryTile category={item.expense.category} />
            <View style={styles.grow}>
              <View style={styles.titleRow}>
                <AppText variant="body" style={[styles.medium, styles.shrink]} numberOfLines={1}>
                  {item.expense.description}
                </AppText>
                {item.expense.note ? <Icon name="note" color={theme.muted} size={16} /> : null}
                {item.expense.receiptId ? <Icon name="receipt" color={theme.muted} size={16} /> : null}
                {item.expense.recurringRuleId ? <Icon name="repeat" color={theme.muted} size={16} /> : null}
              </View>
              <AppText variant="caption" color={theme.muted} numberOfLines={1}>
                {item.expense.categoryLabel ? `${item.expense.categoryLabel} · ${paidBy}` : paidBy}
              </AppText>
            </View>
            <View style={styles.right}>
              <AppText variant="caption" color={theme.muted}>
                {share.lead}
              </AppText>
              {share.amount ? (
                <AppText variant="label" color={toneColor(theme, share.tone)} style={styles.bold}>
                  {share.amount}
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
            <Icon name="checkCircle" color={theme.onPrimarySoft} size={20} />
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
              {money(s.amountPaise)}
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
            money={money}
            payLabel={currency === 'INR' && view.upiIds.has(item.debt.toMemberId) ? 'Pay with UPI' : 'Pay'}
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
      case 'share':
        return (
          <ShareButtons
            label="WhatsApp"
            accessibilityLabel="Share balances on WhatsApp"
            getText={balancesText}
            style={styles.shareBlock}
          />
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
            {item.balance === 0 ? (
              <View style={styles.settledTag}>
                <Icon name="checkCircle" color={theme.positive} size={16} />
                <AppText variant="label" color={theme.muted}>
                  Settled
                </AppText>
              </View>
            ) : (
              <AppText variant="label" color={toneColor(theme, tone)} style={styles.bold}>
                {`${item.balance > 0 ? 'gets back' : 'owes'} ${money(Math.abs(item.balance))}`}
              </AppText>
            )}
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
              <HeaderIconButton icon="share" label="Share" onPress={openShare} />
              <HeaderIconButton
                icon="insights"
                label="Spending insights"
                onPress={() => router.push({ pathname: '/groups/[groupId]/insights', params: { groupId } })}
              />
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
        data={rowsFor(segment, view, showSettled)}
        extraData={showSettled}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 104 }}
        renderItem={renderRow}
      />
      {share.element}

      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add expense"
          onPress={() => router.push({ pathname: '/groups/[groupId]/expenses/new', params: { groupId } })}
          style={({ pressed }) => [styles.fab, { bottom: insets.bottom + 24, opacity: pressed ? 0.85 : 1 }]}
        >
          <GradientSurface style={styles.fabInner}>
            <View style={styles.fabIcon}>
              <Icon name="add" color={theme.onGradient} size={22} />
            </View>
            <AppText variant="label" color={theme.onGradient} style={styles.fabText}>
              Add expense
            </AppText>
          </GradientSurface>
        </Pressable>
      ) : null}
    </View>
  );
}

function SummaryCard({
  view,
  theme,
  nameOf,
  money,
  approx,
  onSettle,
  onShare,
  onInvite,
}: {
  view: GroupView;
  theme: Theme;
  nameOf: (id: string) => string;
  money: (minor: number) => string;
  /** My balance roughly in the home currency, or null. */
  approx: string | null;
  onSettle: () => void;
  onShare: () => void;
  /** Tapping the faces invites people (members who can edit only). */
  onInvite?: () => void;
}) {
  const { myBalance, me, transfers, activeMembers } = view;
  const everyoneSquare = transfers.length === 0 && view.expenseCount > 0;
  const title =
    myBalance > 0
      ? 'You’re owed'
      : myBalance < 0
        ? 'You owe'
        : everyoneSquare
          ? 'Everyone’s settled up'
          : view.expenseCount === 0
            ? 'No expenses yet'
            : 'You’re settled up';
  const mine = transfers.filter((t) => t.fromMemberId === me || t.toMemberId === me).slice(0, 3);
  const stack = activeMembers.slice(0, 3);
  const extra = activeMembers.length - stack.length;

  return (
    <Card style={styles.summary}>
      <View style={styles.summaryTop}>
        <View style={styles.grow} accessible>
          {myBalance === 0 && view.expenseCount > 0 ? (
            <View style={styles.settledTitle}>
              <Icon name="settledAll" color={theme.positive} size={22} />
              <AppText variant="heading" color={theme.positive}>
                {title}
              </AppText>
            </View>
          ) : (
            <AppText variant="label" color={theme.muted}>
              {title}
            </AppText>
          )}
          {myBalance === 0 && view.settled && everyoneSquare ? (
            <AppText variant="caption" color={theme.muted}>
              Since {view.settled.through}
            </AppText>
          ) : null}
          {myBalance !== 0 ? (
            <AppText variant="title" color={myBalance > 0 ? theme.positive : theme.negative}>
              {money(Math.abs(myBalance))}
            </AppText>
          ) : null}
          {myBalance !== 0 && approx ? (
            <AppText variant="caption" color={theme.muted}>
              {approx}
            </AppText>
          ) : null}
        </View>
        <Pressable
          onPress={onInvite}
          disabled={!onInvite}
          hitSlop={6}
          style={styles.avatarStack}
          accessibilityRole={onInvite ? 'button' : undefined}
          accessibilityLabel={`${activeMembers.length} member${activeMembers.length === 1 ? '' : 's'}${onInvite ? '. Invite people' : ''}`}
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
          {onInvite ? (
            <View style={[styles.overlap, styles.more, { backgroundColor: theme.primarySoft, borderColor: theme.surface }]}>
              <Icon name="add" color={theme.onPrimarySoft} size={18} />
            </View>
          ) : null}
        </Pressable>
      </View>

      {view.budget ? (
        <Pressable
          onPress={() => router.push({ pathname: '/groups/[groupId]/settings', params: { groupId: view.group.id } })}
          accessibilityRole="button"
          accessibilityHint="Opens group settings to change the budget"
        >
          <BudgetBar status={view.budget} currency={view.group.currency} />
        </Pressable>
      ) : null}

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
                  {money(t.amountPaise)}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}

      {view.canEdit && transfers.length > 0 ? (
        <View style={styles.summaryActions}>
          <Button label="Settle up" icon="settle" onPress={onSettle} style={styles.grow} />
          <Button label="Share" icon="share" variant="secondary" onPress={onShare} style={styles.grow} />
        </View>
      ) : everyoneSquare ? (
        <Button label="Share with the group" icon="share" variant="secondary" onPress={onShare} />
      ) : null}
    </Card>
  );
}

/** "Settled up · 3 Oct · 12 expenses · ₹45,000", tap to show or hide them. */
function SettledMarker({
  settled,
  money,
  open,
  onToggle,
  theme,
}: {
  settled: SettledPart;
  money: (minor: number) => string;
  open: boolean;
  onToggle: () => void;
  theme: Theme;
}) {
  const count = `${settled.expenseCount} expense${settled.expenseCount === 1 ? '' : 's'}`;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`Settled up ${settled.through}, ${count}, ${money(settled.total)}. ${open ? 'Hide' : 'Show'}`}
      style={({ pressed }) => [
        styles.settledMarker,
        { backgroundColor: theme.primarySoft, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Icon name="settledAll" color={theme.onPrimarySoft} size={22} />
      <View style={styles.grow}>
        <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
          Settled up · {settled.through}
        </AppText>
        <AppText variant="caption" color={theme.onPrimarySoft}>
          {count} · {money(settled.total)}
        </AppText>
      </View>
      <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
        {open ? 'Hide' : 'Show'}
      </AppText>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} color={theme.onPrimarySoft} size={20} />
    </Pressable>
  );
}

function TransferRow({
  debt: t,
  me,
  canEdit,
  nameOf,
  money,
  payLabel,
  theme,
  onRecord,
  onPay,
  onRequest,
}: {
  debt: Debt;
  me: string | null;
  canEdit: boolean;
  nameOf: (id: string) => string;
  money: (minor: number) => string;
  /** "Pay with UPI" when that's what happens, else "Pay" (PayPal, IBAN, ₹ by UPI abroad…). */
  payLabel: string;
  theme: Theme;
  onRecord: () => void;
  onPay: () => void;
  /** Get paid: QR codes, payment details and a WhatsApp reminder. */
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
          {money(t.amountPaise)}
        </AppText>
      </View>
      {canEdit ? (
        <View style={styles.transferActions}>
          {iPay ? (
            <Button
              label={payLabel}
              icon="upiPay"
              onPress={onPay}
              style={styles.grow}
              accessibilityLabel={`Pay ${nameOf(t.toMemberId)}`}
            />
          ) : iReceive ? (
            <Button
              label="Request"
              icon="requestMoney"
              variant="soft"
              onPress={onRequest}
              style={styles.grow}
              accessibilityLabel={`Get paid by ${nameOf(t.fromMemberId)}`}
            />
          ) : null}
          <Button
            label={iPay || iReceive ? 'Record' : 'Record payment'}
            icon="check"
            variant="secondary"
            onPress={onRecord}
            style={styles.grow}
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
  shrink: { flexShrink: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
  shareBlock: { paddingTop: 12, paddingBottom: 4 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  activityRow: { paddingVertical: 12, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  emptyText: { paddingVertical: 12 },
  past: { opacity: 0.55 },
  settledMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    marginTop: 14,
    marginBottom: 4,
  },
  settledTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settledTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fab: { position: 'absolute', right: 20, borderRadius: 28, overflow: 'hidden', elevation: 4 },
  fabInner: {
    minHeight: 56,
    paddingLeft: 18,
    paddingRight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fabIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  fabText: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
});
