import { FlashList } from '@shopify/flash-list';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { groupExpensesQuery } from '@/db/repositories/expenses';
import { getGroup } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId, groupMembersQuery } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { computeBalances, computePairwiseDebts } from '@/domain/balances';
import { formatPaise } from '@/domain/money';
import { simplifyDebts } from '@/domain/simplify';
import { describeMyBalance, describeMyExpenseShare } from '@/features/balances/describe';
import { formatIsoDate } from '@/lib/dates';
import { toneColor, useTheme } from '@/ui/theme';
import { useCallback } from 'react';
const TABLES = ['groups', 'members', 'expenses', 'expense_payers', 'expense_shares', 'settlements'];

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
  const expenseRows = groupExpensesQuery(db, groupId)
    .all()
    .map((expense) => {
      const payers = linesById.get(expense.id)?.payers ?? [];
      const shares = linesById.get(expense.id)?.shares ?? [];
      const myPaid = payers.find((p) => p.memberId === me)?.amountPaise ?? 0;
      const myShare = shares.find((s) => s.memberId === me)?.amountPaise ?? 0;
      const involved =
        payers.some((p) => p.memberId === me) || shares.some((s) => s.memberId === me);
      return { expense, payers, myNet: myPaid - myShare, involved };
    });

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
    expenseRows,
    memberBalances,
    myBalance: me ? (balances.get(me) ?? 0) : 0,
  };
}

export default function GroupDetailScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
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

  const nameOf = (id: string) =>
    id === view.me ? 'You' : (view.names.get(id) ?? 'Unknown member');
  const myBalance = describeMyBalance(view.myBalance);

  const header = (
    <View style={styles.header}>
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
          <Text key={`${t.fromMemberId}-${t.toMemberId}`} style={{ color: theme.text, fontSize: 15 }}>
            {nameOf(t.fromMemberId)} {t.fromMemberId === view.me ? 'pay' : 'pays'}{' '}
            {t.toMemberId === view.me ? 'you' : nameOf(t.toMemberId)}{' '}
            <Text style={{ fontWeight: '600' }}>{formatPaise(t.amountPaise)}</Text>
          </Text>
        ))
      )}

      <Text style={[styles.section, { color: theme.muted }]}>Balances</Text>
      {view.memberBalances.map((m) => {
        const tone = m.balance > 0 ? 'positive' : m.balance < 0 ? 'negative' : 'neutral';
        return (
          <View key={m.id} style={styles.balanceRow}>
            <Text style={{ color: theme.text, fontSize: 15 }}>{nameOf(m.id)}</Text>
            <Text style={{ color: toneColor(theme, tone), fontSize: 15 }}>
              {m.balance === 0 ? 'settled' : `${m.balance > 0 ? '+' : '−'}${formatPaise(Math.abs(m.balance))}`}
            </Text>
          </View>
        );
      })}

      <Text style={[styles.section, { color: theme.muted }]}>Expenses</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: view.group.name }} />
      <FlashList
        data={view.expenseRows}
        keyExtractor={(row) => row.expense.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Text style={[styles.emptyExpenses, { color: theme.muted }]}>No expenses yet.</Text>
        }
        renderItem={({ item }) => {
          const share = describeMyExpenseShare(item.myNet, item.involved);
          const firstPayer = item.payers[0];
          const paidBy =
            item.payers.length === 1 && firstPayer
              ? `${nameOf(firstPayer.memberId)} paid ${formatPaise(item.expense.amountPaise)}`
              : `${item.payers.length} people paid ${formatPaise(item.expense.amountPaise)}`;
          return (
            <View style={[styles.expenseRow, { borderBottomColor: theme.border }]}>
              <View style={styles.expenseMain}>
                <Text style={[styles.expenseTitle, { color: theme.text }]} numberOfLines={1}>
                  {item.expense.description}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 13 }}>
                  {formatIsoDate(item.expense.expenseDate)} · {paidBy}
                </Text>
              </View>
              <Text style={{ color: toneColor(theme, share.tone), fontSize: 13 }}>{share.label}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { padding: 16, gap: 6 },
  myBalance: { fontSize: 20, fontWeight: '700' },
  section: { fontSize: 13, fontWeight: '600', marginTop: 16, textTransform: 'uppercase' },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  expenseMain: { flex: 1, gap: 2 },
  expenseTitle: { fontSize: 16, fontWeight: '500' },
  emptyExpenses: { paddingHorizontal: 16 },
});