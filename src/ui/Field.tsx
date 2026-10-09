import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextInputProps, type TextStyle } from 'react-native';

import { AppText } from './AppText';
import { TextInput } from './Text';
import { useTheme } from './theme';

/** Small heading above a form control. Sentence case (no shouting uppercase labels). */
export function FieldLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <AppText variant="label" color={theme.muted} style={styles.label}>
      {children}
    </AppText>
  );
}

/** Standard single-line input: 48 px tall, rounded, on the card surface. */
export function Input({ style, ...rest }: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const theme = useTheme();
  return (
    <TextInput
      {...rest}
      style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
    />
  );
}

/** Large ₹ amount entry used by the payment screens. Value is the raw text (sanitised by the caller). */
export function AmountInput({
  value,
  onChangeText,
  autoFocus,
  accessibilityLabel = 'Amount in rupees',
}: {
  value: string;
  onChangeText: (text: string) => void;
  autoFocus?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.amountRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <AppText color={theme.muted} style={styles.rupee}>
        ₹
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="0"
        keyboardType="decimal-pad"
        autoFocus={autoFocus}
        accessibilityLabel={accessibilityLabel}
        style={styles.amountInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', marginTop: 10 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 48,
    paddingVertical: 10,
    fontSize: 16,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 16,
  },
  rupee: { fontSize: 28, fontWeight: '500', marginRight: 6 },
  amountInput: { flex: 1, fontSize: 34, fontWeight: '700', paddingVertical: 10 },
});
