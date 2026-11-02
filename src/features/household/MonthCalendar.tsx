import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatQty } from '@/domain/household';
import { AppText } from '@/ui/AppText';
import { useTheme, type Theme } from '@/ui/theme';

import type { CalendarDay } from './view';

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEK_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SPOKEN: Record<CalendarDay['state'], string> = {
  usual: 'as usual',
  absent: 'absent',
  more: 'more than usual',
  less: 'less than usual',
  off: 'off',
};

function colors(theme: Theme, state: CalendarDay['state']) {
  switch (state) {
    case 'usual':
      return { bg: theme.primarySoft, fg: theme.onPrimarySoft, border: theme.primarySoft };
    case 'more':
      return { bg: theme.primary, fg: theme.onPrimary, border: theme.primary };
    case 'less':
      return { bg: theme.surface, fg: theme.text, border: theme.primary };
    case 'absent':
      return { bg: theme.warningSoft, fg: theme.warning, border: theme.warningSoft };
    default:
      return { bg: 'transparent', fg: theme.muted, border: 'transparent' };
  }
}

/**
 * A month grid, Monday first. Plain Views (no calendar library): 31 cells render fast on low-end
 * phones and keep the APK small. Colour is never the only signal: absent days show a cross and
 * changed days their quantity.
 */
export const MonthCalendar = memo(function MonthCalendar({
  days,
  leadingBlanks,
  showQty,
  onPressDay,
}: {
  days: CalendarDay[];
  leadingBlanks: number;
  /** Per-unit services: print the quantity on changed days. */
  showQty: boolean;
  onPressDay?: (day: CalendarDay) => void;
}) {
  const theme = useTheme();
  const cells: (CalendarDay | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...days,
  ];

  return (
    <View>
      <View style={styles.week} importantForAccessibility="no-hide-descendants">
        {WEEK.map((d, i) => (
          <AppText key={WEEK_NAMES[i]} variant="caption" color={theme.muted} style={styles.weekDay}>
            {d}
          </AppText>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`blank-${i}`} style={styles.cell} />;
          const c = colors(theme, day.state);
          const mark =
            day.state === 'absent'
              ? '×'
              : showQty && (day.state === 'more' || day.state === 'less')
                ? formatQty(day.qty)
                : null;
          return (
            <View key={day.date} style={styles.cell}>
              <Pressable
                disabled={!onPressDay || !day.editable}
                onPress={() => onPressDay?.(day)}
                accessibilityRole="button"
                accessibilityLabel={`${day.day}, ${SPOKEN[day.state]}${showQty && day.qty > 0 ? `, ${formatQty(day.qty)}` : ''}${day.isToday ? ', today' : ''}`}
                accessibilityState={{ disabled: !onPressDay || !day.editable }}
                style={({ pressed }) => [
                  styles.day,
                  {
                    backgroundColor: c.bg,
                    borderColor: day.isToday ? theme.text : c.border,
                    borderWidth: day.isToday ? 2 : 1,
                    opacity: pressed ? 0.6 : day.editable || day.state !== 'off' ? 1 : 0.45,
                  },
                ]}
              >
                <AppText variant="label" color={c.fg} style={day.isToday ? styles.bold : undefined}>
                  {day.day}
                </AppText>
                {mark ? (
                  <AppText variant="caption" color={c.fg} style={styles.mark}>
                    {mark}
                  </AppText>
                ) : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  week: { flexDirection: 'row', marginBottom: 6 },
  weekDay: { width: `${100 / 7}%`, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: 3 },
  day: {
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  bold: { fontWeight: '700' },
  mark: { fontSize: 10, lineHeight: 12, marginTop: -2 },
});
