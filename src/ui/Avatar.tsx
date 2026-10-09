import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { avatarColors, initialsOf, safePhotoUrl } from './avatarColors';
import { useTheme } from './theme';

interface AvatarProps {
  /** Stable id (member or account id) that picks the colour. */
  seed: string;
  name: string | null | undefined;
  size?: number;
  /** Only for the signed-in user's own avatar; other members always show initials. */
  photoUrl?: string | null;
  /** Ring in the screen background colour, for overlapping avatar stacks. */
  ring?: boolean;
}

export function Avatar({ seed, name, size = 40, photoUrl, ring = false }: AvatarProps) {
  const theme = useTheme();
  const [photoFailed, setPhotoFailed] = useState(false);
  const { bg, fg } = avatarColors(seed, theme.scheme);
  const uri = photoFailed ? null : safePhotoUrl(photoUrl);
  const shape = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: ring ? 2 : 0,
    borderColor: theme.surface,
  };

  return (
    <View style={[styles.base, shape, { backgroundColor: bg }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // Disk cache: the photo is fetched once, not on every screen or every launch.
          cachePolicy="disk"
          onError={() => setPhotoFailed(true)}
          accessible={false}
        />
      ) : (
        <Text
          style={{ color: fg, fontFamily: theme.fontFamily, fontWeight: '600', fontSize: size * 0.36 }}
          allowFontScaling={false}
        >
          {initialsOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
