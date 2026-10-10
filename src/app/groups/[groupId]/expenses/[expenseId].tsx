import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { deleteExpense, updateExpense } from '@/db/repositories/expenses';
import { ExpenseForm } from '@/features/expenses/ExpenseForm';
import type { DraftParts } from '@/features/expenses/formState';
import { loadFormSetup } from '@/features/expenses/loadFormSetup';
import { describeExpenseError } from '@/features/expenses/messages';
import { saveWithReceipt } from '@/features/receipts/saveWithReceipt';
import { HeaderIconButton } from '@/ui/HeaderIconButton';
import { useTheme } from '@/ui/theme';
import { Text } from '@/ui/Text';

export default function EditExpenseScreen() {
  const { groupId, expenseId } = useLocalSearchParams<{ groupId: string; expenseId: string }>();
  const theme = useTheme();
  const setup = useMemo(() => loadFormSetup(groupId, expenseId), [groupId, expenseId]);

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Edit expense' }} />
        <Text style={{ color: theme.muted }}>{setup.message}</Text>
      </View>
    );
  }

  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';

  const save = (draft: DraftParts): string | null => {
    const { stagedReceipt, ...fields } = draft;
    const result = saveWithReceipt(stagedReceipt, (newReceipt) =>
      updateExpense(appContext, expenseId, {
        ...fields,
        groupId,
        actorMemberId: setup.me,
        newReceipt,
      }),
    );
    if (!result.ok) {
      if ('fileError' in result) return result.fileError;
      return describeExpenseError(result.error, nameOf, {
        entry: draft.foreign?.currency ?? setup.groupCurrency,
        group: setup.groupCurrency,
      });
    }
    router.back();
    return null;
  };

  const confirmDelete = () => {
    Alert.alert('Delete expense?', 'It will be removed from balances but kept in the group history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const result = deleteExpense(appContext, expenseId, setup.me);
          if (result.ok) router.back();
          else
            Alert.alert(
              'Could not delete',
              describeExpenseError(result.error, nameOf, { entry: setup.groupCurrency, group: setup.groupCurrency }),
            );
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Edit expense',
          headerRight: () => (
            <View style={styles.headerActions}>
              {setup.recurringRuleId ? (
                <HeaderIconButton
                  icon="repeat"
                  label="Repeating expense settings"
                  onPress={() =>
                    router.push({
                      pathname: '/groups/[groupId]/recurring/[ruleId]',
                      params: { groupId, ruleId: setup.recurringRuleId! },
                    })
                  }
                />
              ) : null}
              <HeaderIconButton icon="delete" label="Delete expense" color={theme.negative} onPress={confirmDelete} />
            </View>
          ),
        }}
      />
      <ExpenseForm
        members={setup.members}
        initialState={setup.initialState}
        categorySuggestions={setup.categorySuggestions}
        groupCurrency={setup.groupCurrency}
        recentCurrencies={setup.recentCurrencies}
        groupId={groupId}
        expenseId={expenseId}
        submitLabel="Save changes"
        onSubmit={save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});