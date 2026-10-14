import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

/**
 * - primary: filled accent (main action of a screen)
 * - secondary: outlined on the card surface
 * - soft: tinted accent (secondary actions that should still read as "accent")
 * - onGradient: white pill for use ON the hero gradient (balance card)
 * - danger: outlined, rose text (sign out, delete)
 * - whatsapp: soft brand-green pill, only for "send on WhatsApp"
 */
export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'onGradient' | 'danger' | 'whatsapp';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  /**
   * 'sm' = 36 px pill for actions inside a row (its hit area is padded to 44 px),
   * 'md' = 44 px (minimum touch target), 'lg' = 50 px for the main action of a screen.
   */
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  busy = false,
  disabled = false,
  size = 'md',
  style,
  accessibilityLabel,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = busy || disabled;

  const colors = {
    primary: { bg: theme.primary, fg: theme.onPrimary, border: theme.primary },
    secondary: { bg: theme.surface, fg: theme.text, border: theme.border },
    soft: { bg: theme.primarySoft, fg: theme.onPrimarySoft, border: theme.primarySoft },
    onGradient: { bg: '#FFFFFF', fg: theme.gradient[0], border: '#FFFFFF' },
    danger: { bg: theme.surface, fg: theme.negative, border: theme.border },
    whatsapp: { bg: theme.whatsappSoft, fg: theme.onWhatsappSoft, border: theme.whatsappSoft },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      hitSlop={size === 'sm' ? 4 : undefined}
      style={({ pressed }) => [
        styles.base,
        styles[size],
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
          opacity: inactive ? 0.55 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <View style={styles.content}>
          {icon ? (
            // Fixed box: the glyph sits centred on the text's line, not on its baseline.
            <View style={styles.iconBox}>
              <Icon name={icon} color={colors.fg} size={18} />
            </View>
          ) : null}
          <AppText
            variant="label"
            color={colors.fg}
            style={[styles.label, size === 'sm' && styles.smLabel]}
            numberOfLines={1}
          >
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  sm: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14 },
  md: { minHeight: 44, borderRadius: 22 },
  lg: { minHeight: 50, borderRadius: 25 },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  iconBox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  smLabel: { fontSize: 14 },
});
