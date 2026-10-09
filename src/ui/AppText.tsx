import { Text, type TextProps } from 'react-native';

import { useTheme } from './theme';

type Variant = 'body' | 'title' | 'heading' | 'label' | 'caption' | 'amount' | 'display';

const VARIANTS = {
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700' },
  heading: { fontSize: 17, fontWeight: '600' },
  amount: { fontSize: 15, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 12, fontWeight: '400' },
} as const;

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
      style={[{ fontFamily: theme.fontFamily, color: color ?? theme.text }, VARIANTS[variant], style]}
    />
  );
}
