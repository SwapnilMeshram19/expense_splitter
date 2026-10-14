import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from './AppText';
import { Icon, type IconName } from './Icon';
import { useTheme } from './theme';

/**
 * One row of a settings-style list: icon, title, optional detail, chevron. Rows inside a
 * <Card style={listCard}> get hairline dividers via `last`. 52 px tall (above the 44 px target).
 */
export function ListRow({
  icon,
  title,
  detail,
  onPress,
  danger = false,
  busy = false,
  last = false,
  right,
}: {
  icon: IconName;
  title: string;
  /** Short value or hint on the right ("Rent, Wi-Fi"), one line. */
  detail?: string;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
  last?: boolean;
  /** Replaces the chevron (a Switch, a badge). */
  right?: ReactNode;
}) {
  const theme = useTheme();
  const color = danger ? theme.negative : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: busy ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: danger ? theme.surfaceAlt : theme.primarySoft }]}>
        <Icon name={icon} color={danger ? theme.negative : theme.onPrimarySoft} size={18} />
      </View>
      <AppText color={color} style={[styles.grow, styles.title]} numberOfLines={1}>
        {title}
      </AppText>
      {detail ? (
        <AppText variant="label" color={theme.muted} numberOfLines={1} style={styles.detail}>
          {detail}
        </AppText>
      ) : null}
      {busy ? (
        <ActivityIndicator size="small" color={theme.muted} />
      ) : right !== undefined ? (
        right
      ) : !danger ? (
        <Icon name="chevronRight" color={theme.muted} size={18} />
      ) : null}
    </Pressable>
  );
}

/** Style for the Card that holds ListRows (no inner padding top/bottom; rows have their own). */
export const listCardStyle = { paddingVertical: 2, paddingHorizontal: 14 } as const;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  iconBox: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  title: { fontWeight: '500' },
  detail: { maxWidth: '45%' },
});
