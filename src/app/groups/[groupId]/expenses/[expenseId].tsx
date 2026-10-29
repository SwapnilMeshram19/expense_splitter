import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { dataStore } from '@/data';
import { runCommand } from '@/data/hooks';
import { expenseDetailOf } from '@/data/selectors';
import { ExpenseForm } from '@/features/expenses/ExpenseForm';
import type { DraftParts } from '@/features/expenses/formState';
import { loadFormSetup } from '@/features/expenses/loadFormSetup';
import { describeExpenseError } from '@/features/expenses/messages';
import { saveWithReceipt } from '@/features/receipts/saveWithReceipt';
import { expenseShareText } from '@/features/share/loaders';
import { useShareSheet } from '@/features/share/ShareSheet';
import { HeaderIconButton } from '@/ui/HeaderIconButton';
import { haptic } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { AppText } from '@/ui/AppText';

export default function EditExpenseScreen() {
  const { groupId, expenseId } = useLocalSearchParams<{ groupId: string; expenseId: string }>();
  const theme = useTheme();
  const setup = useMemo(() => loadFormSetup(groupId, expenseId), [groupId, expenseId]);
  const share = useShareSheet();

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Edit expense' }} />
        <AppText color={theme.muted}>{setup.message}</AppText>
      </View>
    );
  }

  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';

  const save = async (draft: DraftParts): Promise<string | null> => {
    const { stagedReceipt, repeat: _repeat, ...fields } = draft;
    const before = expenseDetailOf(dataStore().group(groupId)!, expenseId)?.expense.receiptId ?? null;
    const result = await saveWithReceipt(
      stagedReceipt,
      { groupId, expenseId, previousReceiptId: before, nextReceiptId: fields.receiptId },
      (receiptId) =>
        runCommand('expense.update', {
          ...fields,
          groupId,
          expenseId,
          expectedVersion: setup.expectedVersion,
          receiptId: receiptId ?? fields.receiptId,
        }),
    );
    if (!result.ok) {
      if ('fileError' in result) return result.fileError;
      return describeExpenseError(result.error, nameOf, {
        entry: draft.foreign?.currency ?? setup.groupCurrency,
        group: setup.groupCurrency,
      });
    }
    haptic('success');
    router.back();
    return null;
  };

  const confirmDelete = () => {
    Alert.alert('Delete expense?', 'Balances update for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const result = await runCommand('expense.delete', { groupId, expenseId, expectedVersion: setup.expectedVersion });
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
              <HeaderIconButton
                icon="share"
                label="Share this expense"
                onPress={() => {
                  // Shares the saved expense, not unsaved edits in the form.
                  const text = expenseShareText(dataStore().group(groupId), expenseId);
                  if (text) share.open({ title: 'Share expense', getText: () => text });
                }}
              />
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
      {share.element}
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});