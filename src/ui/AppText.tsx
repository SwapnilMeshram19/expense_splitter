import { Text, type TextProps } from 'react-native';

import { useTheme } from './theme';

type Variant = 'body' | 'title' | 'heading' | 'label' | 'caption' | 'amount' | 'display';

// Explicit line heights: Poppins' built-in metrics are tall, which pushed text off-centre next
// to icons and inside pills. With includeFontPadding off (Android), these boxes are exact.
const VARIANTS = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  amount: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const;

/** Shared by every text in the app font (see also ui/Text.tsx). */
export const FONT_RESET = { includeFontPadding: false, textAlignVertical: 'center' } as const;

interface AppTextProps extends TextProps {
  variant?: Variant;
  /** Text colour; defaults to theme.text. */
  color?: string;
}

/**
 * Text in the app font. New and redesigned screens use this; screens not yet redesigned keep
 * react-native Text (system font) until they're migrated.
 */
export function AppText({ variant = 'body', color, style, ...rest }: AppTextProps) {
  const theme = useTheme();
  return (
    <Text
      {...rest}
      style={[FONT_RESET, { fontFamily: theme.fontFamily, color: color ?? theme.text }, VARIANTS[variant], style]}
    />
  );
}
