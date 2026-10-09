import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from './theme';

interface CardProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

/** Surface with a hairline border. Flat on purpose: no shadows, which cost frames on low-end GPUs. */
export function Card({ style, ...rest }: CardProps) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 16 },
});
