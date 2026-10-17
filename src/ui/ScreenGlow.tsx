import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { useTheme } from './theme';

/**
 * Soft accent light at the top of the tab screens: the "aurora" behind the header and hero.
 * One static gradient view (no blur, no animation), so it's free on low-end phones.
 * Render it first inside the screen container; it never takes touches.
 */
export function ScreenGlow() {
  const theme = useTheme();
  // 8-digit hex: accent at low alpha fading to fully transparent.
  const top = theme.scheme === 'dark' ? `${theme.gradient[0]}66` : `${theme.primary}1F`;
  const mid = theme.scheme === 'dark' ? `${theme.gradient[1]}1F` : `${theme.primary}08`;
  return (
    <LinearGradient
      colors={[top, mid, `${theme.background}00`]}
      locations={[0, 0.45, 1]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.6, y: 1 }}
      style={styles.glow}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
});
