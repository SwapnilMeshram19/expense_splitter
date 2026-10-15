import { Pressable, StyleSheet, View } from 'react-native';

import { copyText } from '@/features/share/copyText';

import { AppText } from './AppText';
import { Icon } from './Icon';
import { useTheme } from './theme';

/** Label + value with a copy button: for account numbers, IDs and amounts people paste elsewhere. */
export function CopyField({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: theme.surfaceAlt }]}>
      <View style={styles.grow}>
        <AppText variant="caption" color={theme.muted}>
          {label}
        </AppText>
        <AppText style={styles.value} selectable>
          {value}
        </AppText>
      </View>
      <Pressable
        onPress={() => void copyText(copyValue ?? value, `${label} copied`)}
        accessibilityRole="button"
        accessibilityLabel={`Copy ${label}`}
        style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Icon name="copy" color={theme.onPrimarySoft} size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingLeft: 12, minHeight: 52 },
  grow: { flex: 1, minWidth: 0, paddingVertical: 6 },
  value: { fontWeight: '500' },
  copy: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
