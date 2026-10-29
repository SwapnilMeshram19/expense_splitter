import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { dataStore } from '@/data';
import { runCommand } from '@/data/hooks';
import { expenseDetailOf } from '@/data/selectors';
import { occurrenceId } from '@/domain/recurrence';
import { ExpenseForm } from '@/features/expenses/ExpenseForm';
import type { DraftParts } from '@/features/expenses/formState';
import { loadFormSetup } from '@/features/expenses/loadFormSetup';
import { describeExpenseError } from '@/features/expenses/messages';
import { saveWithReceipt } from '@/features/receipts/saveWithReceipt';
import { deviceTimeZone } from '@/features/recurring/deviceTimeZone';
import { describeRuleError } from '@/features/recurring/messages';
import { newId } from '@/lib/newId';
import { haptic } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { AppText } from '@/ui/AppText';

export default function NewExpenseScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const setup = useMemo(() => loadFormSetup(groupId, null), [groupId]);

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Add expense' }} />
        <AppText color={theme.muted}>{setup.message}</AppText>
      </View>
    );
  }

  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';
  const currencies = (draft: DraftParts) => ({ entry: draft.foreign?.currency ?? setup.groupCurrency, group: setup.groupCurrency });

  /**
   * A repeating expense is saved as its rule; the server creates the expenses that are due (this
   * one too, when it starts today or earlier) at once, with the same ids every phone would use.
   */
  const saveRepeating = async (draft: DraftParts): Promise<string | null> => {
    const { stagedReceipt, repeat, ...fields } = draft;
    const ruleId = newId();
    const rule = await runCommand('recurring.create', {
      groupId,
      id: ruleId,
      description: fields.description,
      amountPaise: fields.amountPaise,
      category: fields.category,
      categoryLabel: fields.categoryLabel,
      note: fields.note,
      payers: fields.payers,
      splitInput: fields.splitInput,
      frequency: repeat!.frequency,
      startDate: fields.expenseDate,
      endDate: repeat!.endDate,
      timeZone: deviceTimeZone(),
    });
    if (!rule.ok) return describeRuleError(rule.error, nameOf, setup.groupCurrency);

    // A photo belongs to this first expense, not to the rule.
    const first = occurrenceId(ruleId, fields.expenseDate);
    const occurrence = expenseDetailOf(dataStore().group(groupId)!, first)?.expense;
    if (stagedReceipt && occurrence) {
      const attached = await saveWithReceipt(stagedReceipt, { groupId, expenseId: first, nextReceiptId: null }, (receiptId) =>
        runCommand('expense.update', { ...fields, groupId, expenseId: first, expectedVersion: occurrence.version, receiptId }),
      );
      if (!attached.ok) Alert.alert('Saved without the photo', 'Open the expense to attach it again.');
    }
    return null;
  };

  const save = async (draft: DraftParts): Promise<string | null> => {
    if (draft.repeat) {
      const message = await saveRepeating(draft);
      if (message) return message;
    } else {
      const { stagedReceipt, repeat: _repeat, ...fields } = draft;
      const expenseId = newId();
      const result = await saveWithReceipt(stagedReceipt, { groupId, expenseId, nextReceiptId: fields.receiptId }, (receiptId) =>
        runCommand('expense.add', { ...fields, groupId, id: expenseId, receiptId: receiptId ?? fields.receiptId }),
      );
      if (!result.ok) {
        if ('fileError' in result) return result.fileError;
        return describeExpenseError(result.error, nameOf, currencies(draft));
      }
    }
    haptic('success');
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
        repeatMode="optional"
        submitLabel="Save expense"
        onSubmit={save}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
