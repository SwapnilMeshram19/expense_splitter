import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from './theme';

interface CardProps extends ViewProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Surface with a hairline border whose top edge is a touch lighter in dark mode, so cards read as
 * softly lit glass. Flat on purpose: no shadows or blur, which cost frames on low-end GPUs.
 */
export function Card({ style, ...rest }: CardProps) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border, borderTopColor: theme.highlight },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 16 },
});
