import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { createExpense } from '@/db/repositories/expenses';
import { ExpenseForm } from '@/features/expenses/ExpenseForm';
import type { DraftParts } from '@/features/expenses/formState';
import { loadFormSetup } from '@/features/expenses/loadFormSetup';
import { describeExpenseError } from '@/features/expenses/messages';
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
    const result = createExpense(appContext, { ...draft, groupId, actorMemberId: setup.me });
    if (!result.ok) return describeExpenseError(result.error, nameOf);
    router.back();
    return null;
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Add expense' }} />
      <ExpenseForm
        members={setup.members}
        initialState={setup.initialState}
        submitLabel="Save expense"
        onSubmit={save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});