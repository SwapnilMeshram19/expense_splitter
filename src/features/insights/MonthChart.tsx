import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatMoney, formatMoneyCompact, type CurrencyCode } from '@/domain/currency';
import { AppText } from '@/ui/AppText';
import { useTheme } from '@/ui/theme';

import { monthLabel, monthShortName, type MonthTotal } from './compute';

const CHART_HEIGHT = 140;
/** Below this slot width a 3-letter month name doesn't fit; show its first letter. */
const MIN_SLOT_FOR_NAME = 30;

/**
 * Monthly spending as bars, drawn with plain Views: no chart library, no SVG, nothing extra to
 * ship or to slow down a low-end phone. Tap a bar to see that month; tap it again for all time.
 * Every bar is a button with its month and amount, so the chart works with TalkBack too.
 *
 * A monthly budget shows as a line across the chart, so months over it stand out.
 */
export function MonthChart({
  months,
  currency,
  selected,
  onSelect,
  budgetLine,
}: {
  months: readonly MonthTotal[];
  currency: CurrencyCode;
  selected: string | null;
  onSelect: (month: string | null) => void;
  /** Monthly budget limit, minor units; null for none. */
  budgetLine: number | null;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const max = Math.max(1, budgetLine ?? 0, ...months.map((m) => m.total));
  const slot = months.length > 0 ? width / months.length : 0;
  const showNames = slot >= MIN_SLOT_FOR_NAME;

  return (
    <View>
      <View style={styles.scale}>
        <AppText variant="caption" color={theme.muted}>
          {formatMoneyCompact(max, currency)}
        </AppText>
        {budgetLine !== null ? (
          <AppText variant="caption" color={theme.warning}>
            Budget line {formatMoneyCompact(budgetLine, currency)}
          </AppText>
        ) : null}
      </View>
      <View
        style={[styles.plot, { borderBottomColor: theme.border }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {budgetLine !== null ? (
          <View
            pointerEvents="none"
            style={[
              styles.budget,
              { bottom: (budgetLine / max) * CHART_HEIGHT, borderColor: theme.warning },
            ]}
          />
        ) : null}
        {months.map((m) => {
          const isSelected = m.month === selected;
          const dimmed = selected !== null && !isSelected;
          const over = budgetLine !== null && m.total > budgetLine;
          // Non-zero months get at least a sliver, so "a little" never looks like "nothing".
          const height = m.total === 0 ? 0 : Math.max(3, (m.total / max) * CHART_HEIGHT);
          return (
            <Pressable
              key={m.month}
              onPress={() => onSelect(isSelected ? null : m.month)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${monthLabel(m.month, 'long')}, ${formatMoney(m.total, currency)}${over ? ', over budget' : ''}`}
              accessibilityHint={isSelected ? 'Shows all time' : 'Shows this month'}
              style={styles.slot}
              hitSlop={{ top: 8, bottom: 8 }}
            >
              <View
                style={[
                  styles.bar,
                  {
                    height,
                    backgroundColor: over ? theme.negative : theme.primary,
                    opacity: dimmed ? 0.35 : 1,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.labels}>
        {months.map((m, i) => {
          const name = monthShortName(m.month);
          // January carries its year, so a range across New Year reads clearly.
          const yearMark =
            showNames && (i === 0 || m.month.endsWith('-01')) ? `\n${m.month.slice(2, 4)}` : '';
          return (
            <AppText
              key={m.month}
              variant="caption"
              color={m.month === selected ? theme.text : theme.muted}
              style={[styles.label, m.month === selected && styles.bold]}
              numberOfLines={2}
              importantForAccessibility="no"
            >
              {showNames ? `${name}${yearMark}` : name.charAt(0)}
            </AppText>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scale: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  plot: {
    height: CHART_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  budget: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1.5 },
  slot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  bar: { width: '100%', maxWidth: 28, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  labels: { flexDirection: 'row', marginTop: 4 },
  label: { flex: 1, textAlign: 'center' },
  bold: { fontWeight: '600' },
});
