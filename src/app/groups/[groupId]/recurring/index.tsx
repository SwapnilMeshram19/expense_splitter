import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getGroup } from '@/db/repositories/groups';
import { groupRulesQuery, ruleProblem } from '@/db/repositories/recurring';
import { formatMoney } from '@/domain/currency';
import { describeSchedule, nextOccurrence } from '@/domain/recurrence';
import { formatIsoDate, todayIsoDate } from '@/lib/dates';
import { AppText } from '@/ui/AppText';
import { Card } from '@/ui/Card';
import { CategoryTile } from '@/ui/CategoryTile';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

const TABLES = ['recurring_rules', 'members', 'groups'] as const;

function loadRules(groupId: string) {
  const group = getGroup(db, groupId);
  if (!group) return null;
  const today = todayIsoDate();
  return {
    currency: group.currency,
    rules: groupRulesQuery(db, groupId)
      .all()
      .map((rule) => ({
        rule,
        schedule: describeSchedule(rule.frequency, rule.startDate),
        next: nextOccurrence(rule, today),
        problem: ruleProblem(db, rule),
      })),
  };
}

/** Repeating expenses of a group: what repeats, how often, and when next. */
export default function RecurringListScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const compute = useCallback(() => loadRules(groupId), [groupId]);
  const view = useLiveData(TABLES, compute);

  return (
    <>
      <Stack.Screen options={{ title: 'Repeating expenses' }} />
      <ScrollView contentContainerStyle={styles.container}>
        {!view || view.rules.length === 0 ? (
          <Card style={styles.empty}>
            <Icon name="repeat" color={theme.muted} size={28} />
            <AppText color={theme.muted} style={styles.center}>
              Nothing repeats yet. When you add an expense like rent or Wi-Fi, choose how often it
              repeats under “Repeat”.
            </AppText>
          </Card>
        ) : (
          view.rules.map(({ rule, schedule, next, problem }) => (
            <Pressable
              key={rule.id}
              onPress={() =>
                router.push({
                  pathname: '/groups/[groupId]/recurring/[ruleId]',
                  params: { groupId, ruleId: rule.id },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`${rule.description}, ${formatMoney(rule.amountPaise, view.currency)}, ${schedule}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Card style={styles.row}>
                <CategoryTile category={rule.category} />
                <View style={styles.grow}>
                  <AppText variant="body" style={styles.medium} numberOfLines={1}>
                    {rule.description}
                  </AppText>
                  <AppText variant="caption" color={theme.muted} numberOfLines={2}>
                    {schedule}
                  </AppText>
                  {problem ? (
                    <AppText variant="caption" color={theme.warning}>
                      Paused: someone on it has left the group. Open it to change the split.
                    </AppText>
                  ) : (
                    <AppText variant="caption" color={theme.muted}>
                      {next ? `Next on ${formatIsoDate(next)}` : 'Ended'}
                    </AppText>
                  )}
                </View>
                <AppText variant="amount">{formatMoney(rule.amountPaise, view.currency)}</AppText>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 40 },
  empty: { alignItems: 'center', gap: 10, padding: 20 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 },
  grow: { flex: 1, minWidth: 0 },
  medium: { fontWeight: '500' },
});
