import { FlashList } from '@shopify/flash-list';
import { router, Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { activeGroupsQuery } from '@/db/repositories/groups';
import { loadGroupLedger } from '@/db/repositories/ledger';
import { findSelfMemberId } from '@/db/repositories/members';
import { getDeviceUserId } from '@/db/session';
import { computeBalances } from '@/domain/balances';
import { describeMyBalance } from '@/features/balances/describe';
import { getLostGroupIds } from '@/sync/engine';
import { toneColor, useTheme } from '@/ui/theme';

// 'settings' too: the lost-access list lives there and should refresh the labels.
const TABLES = ['groups', 'members', 'expenses', 'expense_payers', 'expense_shares', 'settlements', 'settings'];

function loadGroupRows() {
  const deviceUserId = getDeviceUserId();
  const lost = new Set(getLostGroupIds(appContext));
  return activeGroupsQuery(db)
    .all()
    .map((group) => {
      const me = findSelfMemberId(db, group.id, deviceUserId);
      const ledger = loadGroupLedger(db, group.id);
      const { balances } = computeBalances(ledger.expenses, ledger.settlements);
      return { group, myBalance: me ? (balances.get(me) ?? 0) : 0, lost: lost.has(group.id) };
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
              Create a group for a trip, your flat, or family expenses, or join one with an invite code.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const balance = describeMyBalance(item.myBalance);
          return (
            <Pressable
              onPress={() => router.push({ pathname: '/groups/[groupId]', params: { groupId: item.group.id } })}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: theme.border, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <Text style={[styles.groupName, { color: theme.text }]} numberOfLines={1}>
                {item.group.name}
              </Text>
              <Text style={{ color: toneColor(theme, balance.tone) }}>{balance.label}</Text>
              {item.lost ? (
                <Text style={{ color: theme.warning, fontSize: 13 }}>
                  No longer shared with you · changes stay on this phone
                </Text>
              ) : null}
            </Pressable>
          );
        }}
      />

      <View style={[styles.actions, { bottom: insets.bottom + 24 }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/join')}
          style={[styles.pill, styles.secondaryPill, { borderColor: theme.primary, backgroundColor: theme.background }]}
        >
          <Text style={[styles.pillText, { color: theme.primary }]}>Join</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/groups/new')}
          style={[styles.pill, { backgroundColor: theme.primary }]}
        >
          <Text style={[styles.pillText, { color: theme.onPrimary }]}>+ New group</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  groupName: { fontSize: 17, fontWeight: '600' },
  empty: { padding: 32, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '600' },
  actions: { position: 'absolute', right: 20, flexDirection: 'row', gap: 12 },
  pill: { paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, elevation: 4 },
  secondaryPill: { borderWidth: 1.5 },
  pillText: { fontSize: 16, fontWeight: '600' },
});