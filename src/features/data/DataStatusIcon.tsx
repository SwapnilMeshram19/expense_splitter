import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { useDataStatus } from '@/data/hooks';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

import { describeDataStatus } from './describePending';

/**
 * Header icon that appears only when a change hasn't reached the server: waiting offline, or
 * refused. Everything else is quiet. Tapping opens the list of those changes.
 */
export function DataStatusIcon() {
  const theme = useTheme();
  const view = describeDataStatus(useDataStatus());
  if (!view) return null;

  return (
    <Pressable
      onPress={() => router.push('/pending')}
      accessibilityRole="button"
      accessibilityLabel={`${view.label}. Open details`}
      style={[styles.button, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Icon name={view.icon} color={view.tone === 'warning' ? theme.warning : theme.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
