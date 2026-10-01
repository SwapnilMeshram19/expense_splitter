import { FlashList } from '@shopify/flash-list';
import { router, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { activeGroupsQuery } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { computeBalances } from '@/domain/balances';
import { describeMyBalance } from '@/features/balances/describe';
import { toneColor, useTheme } from '@/ui/theme';

const TABLES = ['groups', 'members', 'expenses', 'expense_payers', 'expense_shares', 'settlements'];

function loadGroupRows() {
  const deviceUserId = getDeviceUserId();
  return activeGroupsQuery(db)
    .all()
    .map((group) => {
      const me = findSelfMemberId(db, group.id, deviceUserId);
      const ledger = loadGroupLedger(db, group.id);
      const { balances } = computeBalances(ledger.expenses, ledger.settlements);
      return { group, myBalance: me ? (balances.get(me) ?? 0) : 0 };
    });
}

export default function GroupsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const rows = useLiveData(TABLES, loadGroupRows);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Groups' }} />

      <FlashList
        data={rows}
        keyExtractor={(row) => row.group.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No groups yet</Text>
            <Text style={{ color: theme.muted, textAlign: 'center' }}>
              Create a group for a trip, your flat, or family expenses.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const balance = describeMyBalance(item.myBalance);
          return (
            <Pressable
              onPress={() =>
                router.push({ pathname: '/groups/[groupId]', params: { groupId: item.group.id } })
              }
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.groupName, { color: theme.text }]} numberOfLines={1}>
                {item.group.name}
              </Text>
              <Text style={{ color: toneColor(theme, balance.tone) }}>{balance.label}</Text>
            </Pressable>
          );
        }}
      />

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/groups/new')}
        style={[styles.fab, { backgroundColor: theme.primary, bottom: insets.bottom + 24 }]}
      >
        <Text style={[styles.fabText, { color: theme.onPrimary }]}>+ New group</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  groupName: { fontSize: 17, fontWeight: '600' },
  empty: { padding: 32, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  fab: { position: 'absolute', right: 20, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, elevation: 4 },
  fabText: { fontSize: 16, fontWeight: '600' },
});