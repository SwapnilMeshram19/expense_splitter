import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { currentUserId, dataStore } from '@/data';
import { useData } from '@/data/hooks';
import { todayIsoDate } from '@/lib/dates';
import { AppText } from '@/ui/AppText';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

import { loadHouseholdList } from './view';

/**
 * One line on the group screen: today's home services ("Milk 1 L as usual · Maid came"). Only
 * shown once the group has a service, so groups for trips look exactly as before.
 */
export function HouseholdStrip({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const today = todayIsoDate();
  const summary = useData(() => {
    const list = loadHouseholdList(dataStore().group(groupId), currentUserId(), today);
    if (!list || list.items.length === 0) return null;
    const active = list.items.filter((i) => i.active);
    return {
      text: (active.length > 0 ? active : list.items)
        .slice(0, 3)
        .map((i) => `${i.service.name}: ${i.status}`)
        .join(' · '),
      changed: list.items.some((i) => i.billChanged),
    };
  }, [groupId, today]);
  if (!summary) return null;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/groups/[groupId]/household', params: { groupId } })}
      accessibilityRole="button"
      accessibilityLabel={`Home services today. ${summary.text}. Open`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: theme.surfaceAlt, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name="home" color={theme.text} size={20} />
      <View style={styles.grow}>
        <AppText variant="label" numberOfLines={1}>
          {summary.text}
        </AppText>
        {summary.changed ? (
          <AppText variant="caption" color={theme.warning}>
            A posted bill changed
          </AppText>
        ) : null}
      </View>
      <Icon name="chevronRight" color={theme.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 14,
    minHeight: 48,
    paddingVertical: 8,
  },
  grow: { flex: 1, minWidth: 0 },
});
