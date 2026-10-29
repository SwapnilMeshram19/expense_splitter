import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { runCommand } from '@/data/hooks';
import { parseBudget, type Budget, type BudgetPeriod } from '@/domain/budget';
import type { Group } from '@/domain/model';
import { describeGroupUpdateError } from '@/features/groups/messages';
import {
  minorToInputString,
  parseAmount,
  sanitizeMoneyInput,
} from '@/domain/currency';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { AmountInput } from '@/ui/Field';
import { Segmented } from '@/ui/Segmented';
import { useTheme } from '@/ui/theme';

const PERIODS: readonly { value: BudgetPeriod; label: string }[] = [
  { value: 'total', label: 'Whole trip' },
  { value: 'monthly', label: 'Each month' },
];

/** Set, change or remove the group's budget (group currency). Everyone in the group sees it. */
export function BudgetEditor({ group }: { group: Group; me?: string }) {
  const theme = useTheme();
  const saved = parseBudget(group.budgetPaise, group.budgetPeriod);
  const [busy, setBusy] = useState(false);
  const [amountText, setAmountText] = useState(
    saved ? minorToInputString(saved.limit, group.currency) : '',
  );
  const [period, setPeriod] = useState<BudgetPeriod>(saved?.period ?? 'total');
  const [message, setMessage] = useState<string | null>(null);

  const parsed = amountText.trim() === '' ? null : parseAmount(amountText, group.currency);
  const changed = parsed?.ok ? parsed.minor !== saved?.limit || period !== saved?.period : false;

  const send = async (budget: Budget | null) => {
    setBusy(true);
    const result = await runCommand('group.update', { groupId: group.id, expectedVersion: group.version, budget });
    setBusy(false);
    setMessage(result.ok ? null : describeGroupUpdateError(result.error, group.currency));
    return result.ok;
  };

  const save = () => {
    if (!parsed?.ok) {
      setMessage('Enter the budget amount.');
      return;
    }
    void send({ limit: parsed.minor, period });
  };

  const remove = async () => {
    if (await send(null)) {
      setAmountText('');
      setPeriod('total');
    }
  };

  return (
    <View style={styles.wrap}>
      <AmountInput
        value={amountText}
        currency={group.currency}
        accessibilityLabel="Budget amount"
        onChangeText={(text) => {
          setAmountText(sanitizeMoneyInput(text, amountText, group.currency));
          setMessage(null);
        }}
      />
      <Segmented
        options={PERIODS}
        value={period}
        onChange={setPeriod}
        accessibilityLabel="Budget period"
      />
      <AppText variant="caption" color={theme.muted}>
        {period === 'total'
          ? 'All group expenses count.'
          : 'Resets on the 1st of every month.'}
      </AppText>
      {message ? (
        <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
          {message}
        </AppText>
      ) : null}
      <View style={styles.actions}>
        {changed || !saved ? (
          <Button
            label={saved ? 'Save budget' : 'Set budget'}
            onPress={save}
            busy={busy}
            disabled={!parsed?.ok}
            style={styles.grow}
          />
        ) : null}
        {saved ? (
          <Button label="Remove" icon="delete" variant="danger" onPress={() => void remove()} busy={busy} style={styles.grow} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
});
