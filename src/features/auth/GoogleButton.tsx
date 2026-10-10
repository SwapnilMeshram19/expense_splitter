import { Image } from 'expo-image';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

const G_MARK = require('../../../assets/images/google-g.png');

/**
 * "Continue with Google", drawn the way Google's sign-in branding asks for: the four-colour G on
 * the left, neutral fill and outline (light: white / #747775, dark: #131314 / #8E918F), and the
 * system font (Roboto on Android) for the label rather than the app font. Not tinted by the
 * accent on purpose: a recolored Google button is against the guidelines and looks phishy.
 */
export function GoogleButton({ onPress, busy = false }: { onPress: () => void; busy?: boolean }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const colors = dark
    ? { bg: '#131314', border: '#8E918F', fg: '#E3E3E3' }
    : { bg: '#FFFFFF', border: '#747775', fg: '#1F1F1F' };

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: busy, busy }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.bg, borderColor: colors.border, opacity: busy ? 0.6 : pressed ? 0.85 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <View style={styles.content}>
          <Image source={G_MARK} style={styles.mark} contentFit="contain" accessible={false} />
          <Text style={[styles.label, { color: colors.fg }]} numberOfLines={1}>
            Continue with Google
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 50, borderRadius: 25, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 16 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  mark: { width: 20, height: 20 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500', includeFontPadding: false },
});
