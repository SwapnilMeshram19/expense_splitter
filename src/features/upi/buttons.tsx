import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { useTheme } from '@/ui/theme';

/** Main action of the UPI screens (kept as a thin wrapper so pay/request/upi/join keep their API). */
export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Button label={label} onPress={onPress} disabled={disabled} size="lg" style={styles.submit} />;
}

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
  submit: { marginTop: 16 },
  link: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  linkText: { fontWeight: '600' },
});
