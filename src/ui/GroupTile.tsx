import { StyleSheet, Text, View } from 'react-native';

import { avatarColors, initialsOf } from './avatarColors';
import { useTheme } from './theme';

/** Rounded-square group badge: initials on a colour derived from the group id (same on every phone). */
export function GroupTile({ groupId, name, size = 44 }: { groupId: string; name: string; size?: number }) {
  const theme = useTheme();
  const { bg, fg } = avatarColors(groupId, theme.scheme);
  return (
    <View
      style={[styles.tile, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg }]}
      accessible={false}
    >
      <Text
        style={{ color: fg, fontFamily: theme.fontFamily, fontWeight: '600', fontSize: size * 0.36 }}
        allowFontScaling={false}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
