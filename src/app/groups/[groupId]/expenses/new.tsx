import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { createExpense } from '@/db/repositories/expenses';
import { ExpenseForm } from '@/features/expenses/ExpenseForm';
import type { DraftParts } from '@/features/expenses/formState';
import { loadFormSetup } from '@/features/expenses/loadFormSetup';
import { describeExpenseError } from '@/features/expenses/messages';
import { saveWithReceipt } from '@/features/receipts/saveWithReceipt';
import { useTheme } from '@/ui/theme';
import { Text } from '@/ui/Text';

export default function NewExpenseScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const setup = useMemo(() => loadFormSetup(groupId, null), [groupId]);

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Add expense' }} />
        <Text style={{ color: theme.muted }}>{setup.message}</Text>
      </View>
    );
  }

  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';

  const save = (draft: DraftParts): string | null => {
    const { stagedReceipt, ...fields } = draft;
    const result = saveWithReceipt(stagedReceipt, (newReceipt) =>
      createExpense(appContext, {
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

  return (
    <>
      <Stack.Screen options={{ title: 'Add expense' }} />
      <ExpenseForm
        members={setup.members}
        initialState={setup.initialState}
        categorySuggestions={setup.categorySuggestions}
        groupCurrency={setup.groupCurrency}
        recentCurrencies={setup.recentCurrencies}
        groupId={groupId}
        expenseId={null}
        submitLabel="Save expense"
        onSubmit={save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});