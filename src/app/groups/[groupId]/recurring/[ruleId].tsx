import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { deleteRule, updateRule } from '@/db/repositories/recurring';
import { ExpenseForm } from '@/features/expenses/ExpenseForm';
import type { DraftParts } from '@/features/expenses/formState';
import { deviceTimeZone } from '@/features/recurring/deviceTimeZone';
import { loadRuleSetup } from '@/features/recurring/loadRuleSetup';
import { describeRuleError } from '@/features/recurring/messages';
import { HeaderIconButton } from '@/ui/HeaderIconButton';
import { Text } from '@/ui/Text';
import { useTheme } from '@/ui/theme';

/** Edit a repeating expense. Changes apply to future occurrences; past ones stay as they are. */
export default function EditRuleScreen() {
  const { groupId, ruleId } = useLocalSearchParams<{ groupId: string; ruleId: string }>();
  const theme = useTheme();
  const setup = useMemo(() => loadRuleSetup(groupId, ruleId), [groupId, ruleId]);

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Repeating expense' }} />
        <Text style={{ color: theme.muted }}>{setup.message}</Text>
      </View>
    );
  }

  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';

  const save = (draft: DraftParts): string | null => {
    if (!draft.repeat) return 'Choose how often it repeats.';
    const result = updateRule(appContext, ruleId, {
      groupId,
      description: draft.description,
      amountPaise: draft.amountPaise,
      category: draft.category,
      categoryLabel: draft.categoryLabel,
      note: draft.note,
      payers: draft.payers,
      splitInput: draft.splitInput,
      frequency: draft.repeat.frequency,
      startDate: draft.expenseDate,
      endDate: draft.repeat.endDate,
      timeZone: deviceTimeZone(), // ignored on update: the rule keeps the zone it was made in
      actorMemberId: setup.me,
    });
    if (!result.ok) return describeRuleError(result.error, nameOf, setup.groupCurrency);
    router.back();
    return null;
  };

  const confirmStop = () =>
    Alert.alert(
      'Stop repeating?',
      'No new ones will be added. Expenses already added stay, and you can still edit or delete them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: () => {
            const result = deleteRule(appContext, ruleId, setup.me);
            if (result.ok) router.back();
            else
              Alert.alert(
                'Couldn’t stop it',
                describeRuleError(result.error, nameOf, setup.groupCurrency),
              );
          },
        },
      ],
    );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Repeating expense',
          headerRight: () => (
            <HeaderIconButton icon="delete" label="Stop repeating" onPress={confirmStop} />
          ),
        }}
      />
      <ExpenseForm
        members={setup.members}
        initialState={setup.initialState}
        categorySuggestions={setup.categorySuggestions}
        groupCurrency={setup.groupCurrency}
        groupId={groupId}
        expenseId={null}
        repeatMode="rule"
        scheduleLocked={setup.scheduleLocked}
        submitLabel="Save for future ones"
        onSubmit={save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
