import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'highlight' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
  /** 'md' = 44 px (minimum touch target), 'lg' = 50 px for the main action of a screen. */
  size?: 'md' | 'lg';
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
    highlight: { bg: theme.highlight, fg: theme.onHighlight, border: theme.highlight },
    danger: { bg: theme.surface, fg: theme.negative, border: theme.border },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
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
          {icon ? <Icon name={icon} color={colors.fg} size={18} /> : null}
          <AppText variant="label" color={colors.fg} style={styles.label} numberOfLines={1}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  md: { minHeight: 44, borderRadius: 22 },
  lg: { minHeight: 50, borderRadius: 25 },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15, fontWeight: '600' },
});
