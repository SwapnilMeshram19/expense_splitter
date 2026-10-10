import { Pressable, StyleSheet } from 'react-native';

import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

/** 44×44 icon button for the stack header's right side. Always needs a spoken label. */
export function HeaderIconButton({
  icon,
  label,
  onPress,
  color,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Defaults to the text colour; pass theme.negative for destructive actions. */
  color?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} color={color ?? theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
