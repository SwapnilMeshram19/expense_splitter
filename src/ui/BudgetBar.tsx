import { StyleSheet, View } from 'react-native';

import type { BudgetStatus } from '@/domain/budget';
import { formatMoney, type CurrencyCode } from '@/domain/currency';

import { AppText } from './AppText';
import { useTheme } from './theme';

/** "₹42,000 of ₹60,000 · ₹18,000 left" (or "₹2,000 over"), for labels and screen readers. */
export function budgetSummary(status: BudgetStatus, currency: CurrencyCode): string {
  const money = (minor: number) => formatMoney(minor, currency);
  const tail =
    status.remaining >= 0 ? `${money(status.remaining)} left` : `${money(-status.remaining)} over`;
  const scope = status.period === 'monthly' ? 'This month: ' : '';
  return `${scope}${money(status.spent)} of ${money(status.limit)} · ${tail}`;
}

/**
 * Progress against a group budget. Accent colour while comfortable, amber from 80%, rose when over
 * (the same rose as "you owe"). Text carries the meaning too, never colour alone.
 */
export function BudgetBar({
  status,
  currency,
  compact = false,
}: {
  status: BudgetStatus;
  currency: CurrencyCode;
  compact?: boolean;
}) {
  const theme = useTheme();
  const fill =
    status.level === 'over'
      ? theme.negative
      : status.level === 'near'
        ? theme.warning
        : theme.primary;
  const pct = Math.round(status.ratio * 100);
  const summary = budgetSummary(status, currency);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Budget, ${pct}% used. ${summary}`}
      accessibilityValue={{ min: 0, max: 100, now: Math.min(pct, 100) }}
      style={styles.wrap}
    >
      <View
        style={[
          styles.track,
          compact && styles.trackCompact,
          { backgroundColor: theme.surfaceAlt },
        ]}
      >
        <View
          style={[
            styles.fill,
            { width: `${Math.min(status.ratio, 1) * 100}%`, backgroundColor: fill },
          ]}
        />
      </View>
      <AppText
        variant="caption"
        color={status.level === 'over' ? theme.negative : theme.muted}
        numberOfLines={1}
      >
        {compact ? `${pct}% of budget${status.period === 'monthly' ? ' this month' : ''}` : summary}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  trackCompact: { height: 5, borderRadius: 3 },
  fill: { height: '100%', borderRadius: 4 },
});
