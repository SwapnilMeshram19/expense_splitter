import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getDeviceUserId } from '@/db/session';
import { editableGroups } from '@/features/overview/openAddExpense';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { GroupTile } from '@/ui/GroupTile';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

const TABLES = ['groups', 'members', 'settings'];
const load = () => editableGroups(db, getDeviceUserId());

/** Opened by the centre "+" when there are several groups. Read-only groups aren't offered. */
export default function PickGroupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const groups = useLiveData(TABLES, load);

  return (
    <View style={styles.container}>
      <FlashList
        data={groups}
        keyExtractor={(group) => group.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <AppText color={theme.muted}>No group you can add expenses to.</AppText>
            <Button label="New group" icon="add" onPress={() => router.replace('/groups/new')} />
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              // replace: Back from the expense form returns to where "+" was tapped, not this list.
              router.replace({ pathname: '/groups/[groupId]/expenses/new', params: { groupId: item.id } })
            }
            style={({ pressed }) => [styles.row, { borderBottomColor: theme.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <GroupTile groupId={item.id} name={item.name} size={40} />
            <AppText variant="amount" style={styles.name} numberOfLines={1}>
              {item.name}
            </AppText>
            <Icon name="chevronRight" color={theme.muted} size={18} />
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, fontWeight: '500' },
  empty: { gap: 12, paddingVertical: 24, alignItems: 'flex-start' },
});
