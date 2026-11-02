import { StyleSheet, View } from 'react-native';

import { formatQty, MAX_DAY_QTY } from '@/domain/household';
import { AppText } from '@/ui/AppText';
import { haptic } from '@/ui/haptics';
import { Icon } from '@/ui/Icon';
import { PressableScale } from '@/ui/PressableScale';
import { useTheme } from '@/ui/theme';

/**
 * − 1.5 L +. Quantities in hundredths; `step` is the unit's step (half litres, whole packets).
 * Big round targets (44 px): this is tapped every morning, often one-handed.
 */
export function QtyStepper({
  value,
  step,
  unit,
  min = 0,
  max = MAX_DAY_QTY,
  onChange,
  label,
  disabled = false,
}: {
  value: number;
  step: number;
  unit: string;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  /** Spoken name, e.g. "Milk today". */
  label: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const change = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next === value) return;
    haptic('selection');
    onChange(next);
  };
  const button = (icon: 'add' | 'remove', delta: number, enabled: boolean) => (
    <PressableScale
      onPress={() => change(delta)}
      disabled={disabled || !enabled}
      accessibilityRole="button"
      accessibilityLabel={`${delta > 0 ? 'More' : 'Less'} ${label}`}
      hitSlop={4}
      style={[
        styles.button,
        { backgroundColor: theme.primarySoft, opacity: disabled || !enabled ? 0.4 : 1 },
      ]}
    >
      {icon === 'add' ? (
        <Icon name="add" color={theme.onPrimarySoft} size={20} />
      ) : (
        <AppText variant="heading" color={theme.onPrimarySoft} style={styles.minus}>
          −
        </AppText>
      )}
    </PressableScale>
  );

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${formatQty(value)} ${unit}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => change(e.nativeEvent.actionName === 'increment' ? step : -step)}
    >
      {button('remove', -step, value > min)}
      <AppText variant="amount" style={styles.value} numberOfLines={1}>
        {formatQty(value)} {unit}
      </AppText>
      {button('add', step, value < max)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minus: { fontSize: 22, lineHeight: 24 },
  value: { minWidth: 64, textAlign: 'center' },
});
