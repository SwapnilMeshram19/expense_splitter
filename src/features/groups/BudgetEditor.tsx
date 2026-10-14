import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { appContext } from '@/db/appContext';
import { groupBudget, setGroupBudget } from '@/db/repositories/groups';
import type { Group } from '@/db/schema';
import type { BudgetPeriod } from '@/domain/budget';
import {
  formatMoney,
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
export function BudgetEditor({ group, me }: { group: Group; me: string }) {
  const theme = useTheme();
  const saved = groupBudget(group);
  const [amountText, setAmountText] = useState(
    saved ? minorToInputString(saved.limit, group.currency) : '',
  );
  const [period, setPeriod] = useState<BudgetPeriod>(saved?.period ?? 'total');
  const [message, setMessage] = useState<string | null>(null);

  const parsed = amountText.trim() === '' ? null : parseAmount(amountText, group.currency);
  const changed = parsed?.ok ? parsed.minor !== saved?.limit || period !== saved?.period : false;

  const save = () => {
    if (!parsed?.ok) {
      setMessage('Enter the budget amount.');
      return;
    }
    const result = setGroupBudget(appContext, {
      groupId: group.id,
      budget: { limit: parsed.minor, period },
      actorMemberId: me,
    });
    setMessage(
      result.ok
        ? null
        : result.error.code === 'INVALID_BUDGET'
          ? `Enter a budget up to ${formatMoney(result.error.max, group.currency)}.`
          : 'You can’t change this group.',
    );
  };

  const remove = () => {
    const result = setGroupBudget(appContext, {
      groupId: group.id,
      budget: null,
      actorMemberId: me,
    });
    if (result.ok) {
      setAmountText('');
      setPeriod('total');
      setMessage(null);
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
            disabled={!parsed?.ok}
            style={styles.grow}
          />
        ) : null}
        {saved ? (
          <Button label="Remove" icon="delete" variant="danger" onPress={remove} style={styles.grow} />
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
