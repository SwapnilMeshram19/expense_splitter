import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/ui/AppText';
import { useTheme } from '@/ui/theme';

export function LinkButton({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link} hitSlop={8}>
      <AppText variant="label" color={color ?? theme.onPrimarySoft} style={styles.linkText}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Centred under the full-width main button, so the column of actions lines up.
  link: { paddingVertical: 10, minHeight: 44, justifyContent: 'center', alignSelf: 'center' },
  linkText: { fontWeight: '600' },
});
