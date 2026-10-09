import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyProfile } from '@/features/auth/useMyProfile';
import { greetingFor } from '@/lib/dates';
import { SyncIndicator } from '@/sync/SyncIndicator';

import { AppText } from './AppText';
import { Avatar } from './Avatar';
import { useTheme } from './theme';

interface TabHeaderProps {
  /** Big title ("Settle up"). Omit for the greeting header on Home. */
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
  // Computed once per mount: rendering must stay pure (no clock reads during render).
  const [greeting] = useState(() => greetingFor(new Date()));
  const firstName = me.name?.trim().split(/\s+/)[0] ?? null;

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
    <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: theme.background }]}>
      {title ? (
        <AppText variant="title" accessibilityRole="header" style={styles.grow} numberOfLines={1}>
          {title}
        </AppText>
      ) : (
        <>
          {avatar}
          <View style={styles.grow}>
            <AppText variant="label" color={theme.muted}>
              {greeting}
            </AppText>
            <AppText variant="heading" accessibilityRole="header" numberOfLines={1} style={styles.name}>
              {firstName ?? 'Welcome'}
            </AppText>
          </View>
        </>
      )}
      {right}
      <SyncIndicator />
      {title ? avatar : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  grow: { flex: 1, minWidth: 0 },
  name: { fontSize: 18, lineHeight: 24 },
});
