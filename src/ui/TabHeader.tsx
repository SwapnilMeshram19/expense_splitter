import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyProfile } from '@/features/auth/useMyProfile';
import { greetingFor } from '@/lib/dates';
import { SyncIndicator } from '@/sync/SyncIndicator';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { BrandMark } from './BrandMark';
import { useTheme } from './theme';

interface TabHeaderProps {
  /** Big title ("Settle up"). Omit on Home, which shows the app's logo and name instead. */
  title?: string;
  /** Hide the avatar shortcut (on the Account tab itself). */
  hideAvatar?: boolean;
  right?: ReactNode;
}

/** In-screen header for the tab screens (the navigator's own header is hidden there). */
export function TabHeader({ title, hideAvatar = false, right }: TabHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const me = useMyProfile();
  const avatar = hideAvatar ? null : (
    <Pressable
      onPress={() => router.navigate('/account')}
      accessibilityRole="button"
      accessibilityLabel={me.signedIn ? 'Open account' : 'Sign in or open account'}
      hitSlop={4}
    >
      <Avatar seed={me.id} name={me.name ?? '?'} photoUrl={me.photoUrl} size={44} />
    </Pressable>
  );

  return (
    <View
      style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: theme.background }]}
    >
      {title ? (
        <AppText variant="title" accessibilityRole="header" style={styles.grow} numberOfLines={1}>
          {title}
        </AppText>
      ) : (
        <View style={styles.grow}>
          <BrandMark />
        </View>
      )}
      {right}
      <SyncIndicator />
      {avatar}
    </View>
  );
}

/** "Good evening, Swapnil": the line under the Home header. */
export function Greeting() {
  const theme = useTheme();
  const me = useMyProfile();
  // Computed once per mount: rendering must stay pure (no clock reads during render).
  const [greeting] = useState(() => greetingFor(new Date()));
  const firstName = me.name?.trim().split(/\s+/)[0] ?? null;
  return (
    <AppText variant="heading" color={theme.text} numberOfLines={1}>
      {firstName ? `${greeting}, ${firstName}` : greeting}
    </AppText>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  grow: { flex: 1, minWidth: 0 },
});
