import { useState } from 'react';
import { StyleSheet, View, type KeyboardTypeOptions } from 'react-native';

import { AppText } from './AppText';
import { TextInput } from './Text';
import { useTheme } from './theme';

/** Room for the caret after the last digit. */
const CARET_ROOM = 4;

/**
 * Font size for the hero amount: long amounts shrink instead of scrolling inside the box.
 * Counts characters, not width, so it is stable while typing (no feedback loop with layout).
 */
export function heroAmountFontSize(text: string): number {
  const length = text.length;
  if (length <= 7) return 42;
  if (length <= 10) return 36;
  if (length <= 13) return 30;
  return 26;
}

/**
 * Big centred amount ("₹ 1,250") whose input box is exactly as wide as what is typed.
 *
 * A centred TextInput with a fixed minimum width draws the placeholder in the middle and the caret
 * somewhere else (Android puts it at the start of the empty box, iOS at the centre), which reads as
 * "0   |". Here the box hugs the text: a hidden Text in the same font measures the value (or the
 * "0" placeholder) and the input takes that width, so symbol, digits and caret always sit together.
 */
export function HeroAmountInput({
  prefix,
  value,
  onChangeText,
  keyboardType,
  accessibilityLabel,
  autoFocus,
  placeholder = '0',
}: {
  prefix: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType: KeyboardTypeOptions;
  accessibilityLabel: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const shown = value === '' ? placeholder : value;
  const fontSize = heroAmountFontSize(shown);
  const textStyle = { fontSize, lineHeight: Math.round(fontSize * 1.25), fontFamily: theme.fontFamily };

  return (
    <View style={styles.row}>
      <AppText style={[styles.prefix, { fontSize: Math.round(fontSize * 0.66) }]} color={theme.muted}>
        {prefix}
      </AppText>
      <View>
        {/* Measures the text; never shown, never read by screen readers. The wide fixed-size box
            lets it take its natural width instead of the input's current one. */}
        <View style={styles.measureBox} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <AppText
            style={[styles.amount, textStyle, styles.measure]}
            onLayout={(e) => setWidth(Math.ceil(e.nativeEvent.layout.width))}
            accessible={false}
            numberOfLines={1}
          >
            {shown}
          </AppText>
        </View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType={keyboardType}
          accessibilityLabel={accessibilityLabel}
          autoFocus={autoFocus}
          selectTextOnFocus={false}
          style={[styles.amount, textStyle, styles.input, width > 0 && { width: width + CARET_ROOM }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, maxWidth: '100%' },
  prefix: { fontWeight: '500' },
  amount: { fontWeight: '700', letterSpacing: -0.5 },
  input: { textAlign: 'left', paddingHorizontal: 0, paddingVertical: 4, minWidth: 24 },
  measureBox: { position: 'absolute', left: 0, top: 0, width: 2000, opacity: 0 },
  measure: { alignSelf: 'flex-start' },
});
