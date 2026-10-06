import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/ui/theme';

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.submit, { backgroundColor: theme.primary, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <Text style={[styles.submitText, { color: theme.onPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function LinkButton({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link} hitSlop={8}>
      <Text style={{ color: color ?? theme.primary, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  submit: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitText: { fontSize: 16, fontWeight: '600' },
  link: { paddingVertical: 10 },
});