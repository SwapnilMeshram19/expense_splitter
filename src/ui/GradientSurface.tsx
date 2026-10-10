import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from './theme';

/**
 * The accent's diagonal gradient (top-left → bottom-right), for hero surfaces only: the balance
 * card and the centre "+" button. Content on it uses theme.onGradient (white). One native view,
 * no blur or shadow, so it costs nothing extra on low-end phones.
 */
export function GradientSurface({ style, children }: { style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <LinearGradient colors={theme.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}
