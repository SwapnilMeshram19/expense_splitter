import { FlashList } from '@shopify/flash-list';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { groupExpensesQuery } from '@/db/repositories/expenses';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { deleteSettlement, groupSettlementsQuery } from '@/db/repositories/settlements';
import type { Expense, Settlement } from '@/db/schema';
import { getDeviceUserId } from '@/db/session';
import { computeBalances, computePairwiseDebts, type PayerLine } from '@/domain/balances';
import { formatPaise } from '@/domain/money';
import { simplifyDebts } from '@/domain/simplify';
import { describeMyBalance, describeMyExpenseShare } from '@/features/balances/describe';
import { describeSettlementError, METHOD_LABELS } from '@/features/settlements/messages';
import { PendingUpiBanner } from '@/features/upi/PendingUpiBanner';
import { formatIsoDate, toLocalIsoDate } from '@/lib/dates';
import { toneColor, useTheme } from '@/ui/theme';

const TABLES = ['groups', 'members', 'expenses', 'expense_payers', 'expense_shares', 'settlements'];

type HistoryRow =
  | {
    kind: 'expense';
    key: string;
    date: string;
    createdAt: number;
    expense: Expense;
    payers: readonly PayerLine[];
    myNet: number;
    involved: boolean;
  }
  | { kind: 'settlement'; key: string; date: string; createdAt: number; settlement: Settlement };

function loadGroupView(groupId: string) {
  const group = getGroup(db, groupId);
  if (!group) return null;

  const me = findSelfMemberId(db, groupId, getDeviceUserId());
  const allMembers = groupMembersQuery(db, groupId).all();
  const names = new Map(allMembers.map((m) => [m.id, m.displayName]));

  const ledger = loadGroupLedger(db, groupId);
  const { balances, invalidIds } = computeBalances(ledger.expenses, ledger.settlements);
  const transfers = group.simplifyDebts
    ? simplifyDebts(balances)
    : computePairwiseDebts(ledger.expenses, ledger.settlements).debts;

  const linesById = new Map(ledger.expenses.map((e) => [e.id, e]));
  const expenseRows: HistoryRow[] = groupExpensesQuery(db, groupId)
    .all()
    .map((expense) => {
      const payers = linesById.get(expense.id)?.payers ?? [];
      const shares = linesById.get(expense.id)?.shares ?? [];
      const myPaid = payers.find((p) => p.memberId === me)?.amountPaise ?? 0;
      const myShare = shares.find((s) => s.memberId === me)?.amountPaise ?? 0;
      const involved =
        payers.some((p) => p.memberId === me) || shares.some((s) => s.memberId === me);
      return {
        kind: 'expense',
        key: `e-${expense.id}`,
        date: expense.expenseDate,
        createdAt: expense.createdAt,
        expense,
        payers,
        myNet: myPaid - myShare,
        involved,
      };
    });

  const settlementRows: HistoryRow[] = groupSettlementsQuery(db, groupId)
    .all()
    .map((settlement) => ({
      kind: 'settlement',
      key: `s-${settlement.id}`,
      date: toLocalIsoDate(new Date(settlement.settledAt)),
      createdAt: settlement.createdAt,
      settlement,
    }));

  // Newest first: by calendar date, then by creation time within the same day.
  const history = [...expenseRows, ...settlementRows].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.createdAt - a.createdAt,
  );

  // Show active members, plus anyone who left but still has a non-zero balance.
  const memberBalances = allMembers
    .filter((m) => m.deletedAt === null || (balances.get(m.id) ?? 0) !== 0)
    .map((m) => ({ id: m.id, balance: balances.get(m.id) ?? 0 }));

  return {
    group,
    me,
    names,
    invalidCount: invalidIds.length,
    transfers,
    history,
    memberBalances,
    myBalance: me ? (balances.get(me) ?? 0) : 0,
  };
}

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const compute = useCallback(() => loadGroupView(groupId), [groupId]);
  const view = useLiveData(TABLES, compute);

  if (!view) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Group' }} />
        <Text style={{ color: theme.muted }}>This group no longer exists.</Text>
      </View>
    );
  }

  const me = view.me;
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
    if (!me) return;
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

  const myBalance = describeMyBalance(view.myBalance);

  const header = (
    <View style={styles.header}>
      {!me ? (
        <Text style={{ color: theme.warning }}>
          You’re not a member of this group, so you can’t add expenses here. Open Settings to
          delete it.
        </Text>
      ) : null}
      {me ? <PendingUpiBanner groupId={groupId} nameOf={nameOf} /> : null}
      <Text style={[styles.myBalance, { color: toneColor(theme, myBalance.tone) }]}>
        {myBalance.label.charAt(0).toUpperCase() + myBalance.label.slice(1)}
      </Text>

      {view.invalidCount > 0 ? (
        <Text style={{ color: theme.warning }}>
          {view.invalidCount} record{view.invalidCount > 1 ? 's' : ''} couldn’t be read and{' '}
          {view.invalidCount > 1 ? 'are' : 'is'} excluded from balances.
        </Text>
      ) : null}

      <Text style={[styles.section, { color: theme.muted }]}>
        {view.group.simplifyDebts ? 'Suggested payments' : 'Who owes whom'}
      </Text>
      {view.transfers.length === 0 ? (
        <Text style={{ color: theme.muted }}>Everyone is settled up.</Text>
      ) : (
        view.transfers.map((t) => (
          <View key={`${t.fromMemberId}-${t.toMemberId}`} style={styles.transferRow}>
            <Pressable
              disabled={!me}
              onPress={() =>
                openSettle({ from: t.fromMemberId, to: t.toMemberId, amount: String(t.amountPaise) })
              }
              style={({ pressed }) => [styles.transferMain, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.transferText, { color: theme.text }]}>
                {nameOf(t.fromMemberId)} {t.fromMemberId === me ? 'pay' : 'pays'}{' '}
                {t.toMemberId === me ? 'you' : nameOf(t.toMemberId)}{' '}
                <Text style={{ fontWeight: '600' }}>{formatPaise(t.amountPaise)}</Text>
              </Text>
            </Pressable>
            {me && t.fromMemberId === me ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Pay ${nameOf(t.toMemberId)} with UPI`}
                onPress={() => openPay(t.toMemberId, t.amountPaise)}
              >
                <Text style={{ color: theme.primary, fontWeight: '600' }}>Pay UPI</Text>
              </Pressable>
            ) : me && t.toMemberId === me ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Get paid by ${nameOf(t.fromMemberId)}`}
                onPress={() => openRequest(t.fromMemberId, t.amountPaise)}
              >
                <Text style={{ color: theme.primary, fontWeight: '600' }}>Request</Text>
              </Pressable>
            ) : me ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Record payment from ${nameOf(t.fromMemberId)} to ${nameOf(t.toMemberId)}`}
                onPress={() =>
                  openSettle({ from: t.fromMemberId, to: t.toMemberId, amount: String(t.amountPaise) })
                }
              >
                <Text style={{ color: theme.primary, fontWeight: '600' }}>Record</Text>
              </Pressable>
            ) : null}
          </View>
        ))
      )}
      {me ? (
        <Pressable onPress={() => openSettle()} style={styles.linkButton}>
          <Text style={{ color: theme.primary, fontWeight: '600' }}>Record a payment</Text>
        </Pressable>
      ) : null}

      <Text style={[styles.section, { color: theme.muted }]}>Balances</Text>
      {view.memberBalances.map((m) => {
        const tone = m.balance > 0 ? 'positive' : m.balance < 0 ? 'negative' : 'neutral';
        return (
          <View key={m.id} style={styles.balanceRow}>
            <Text style={{ color: theme.text, fontSize: 15 }}>{nameOf(m.id)}</Text>
            <Text style={{ color: toneColor(theme, tone), fontSize: 15 }}>
              {m.balance === 0
                ? 'settled'
                : `${m.balance > 0 ? '+' : '−'}${formatPaise(Math.abs(m.balance))}`}
            </Text>
          </View>
        );
      })}

      <Text style={[styles.section, { color: theme.muted }]}>History</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: view.group.name,
          headerRight: () => (
            <Pressable
              onPress={() => router.push({ pathname: '/groups/[groupId]/settings', params: { groupId } })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Group settings"
            >
              <Text style={{ color: theme.primary, fontWeight: '600' }}>Settings</Text>
            </Pressable>
          ),
        }}
      />
      <FlashList
        data={view.history}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.kind}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListEmptyComponent={
          <Text style={[styles.emptyHistory, { color: theme.muted }]}>
            No expenses yet. Tap “+ Add expense” to add the first one.
          </Text>
        }
        renderItem={({ item }) => {
          if (item.kind === 'settlement') {
            const s = item.settlement;
            const text =
              s.fromMemberId === me
                ? `You paid ${nameOf(s.toMemberId)}`
                : s.toMemberId === me
                  ? `${nameOf(s.fromMemberId)} paid you`
                  : `${nameOf(s.fromMemberId)} paid ${nameOf(s.toMemberId)}`;
            return (
              <Pressable
                disabled={!me}
                onPress={() => confirmDeleteSettlement(s)}
                style={({ pressed }) => [
                  styles.historyRow,
                  { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={styles.historyMain}>
                  <Text style={[styles.historyTitle, { color: theme.text }]} numberOfLines={1}>
                    💸 {text}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 13 }} numberOfLines={1}>
                    {formatIsoDate(item.date)} · {METHOD_LABELS[s.method]}
                    {s.note ? ` · ${s.note}` : ''}
                  </Text>
                </View>
                <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
                  {formatPaise(s.amountPaise)}
                </Text>
              </Pressable>
            );
          }

          const share = describeMyExpenseShare(item.myNet, item.involved);
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
              style={({ pressed }) => [
                styles.historyRow,
                { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={styles.historyMain}>
                <Text style={[styles.historyTitle, { color: theme.text }]} numberOfLines={1}>
                  {item.expense.description}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  {formatIsoDate(item.date)} · {paidBy}
                </Text>
              </View>
              <Text style={{ color: toneColor(theme, share.tone), fontSize: 13 }}>{share.label}</Text>
            </Pressable>
          );
        }}
      />

      {me ? (
        <View style={[styles.fabRow, { bottom: insets.bottom + 24 }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/groups/[groupId]/expenses/scan', params: { groupId } })}
            style={[styles.fab, styles.fabSecondary, { backgroundColor: theme.surface, borderColor: theme.primary }]}
          >
            <Text style={[styles.fabText, { color: theme.primary }]}>Scan bill</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/groups/[groupId]/expenses/new', params: { groupId } })}
            style={[styles.fab, { backgroundColor: theme.primary }]}
          >
            <Text style={[styles.fabText, { color: theme.onPrimary }]}>+ Add expense</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { padding: 16, gap: 6 },
  myBalance: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 13, fontWeight: '600', marginTop: 16, textTransform: 'uppercase' },
  transferRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  transferMain: { flex: 1 },
  transferText: { fontSize: 15 },
  linkButton: { paddingVertical: 6 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  historyMain: { flex: 1, gap: 2 },
  historyTitle: { fontSize: 16, fontWeight: '500' },
  emptyHistory: { paddingHorizontal: 16 },
  fabRow: { position: 'absolute', right: 20, flexDirection: 'row', gap: 10 },
  fab: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, elevation: 4 },
  fabSecondary: { borderWidth: 1 },
  fabText: { fontSize: 16, fontWeight: '600' },

});