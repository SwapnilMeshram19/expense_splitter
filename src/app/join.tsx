import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/ui/theme';

const CODE_PATTERN = /^[A-Z0-9-]{4,20}$/i;

/** Invite link landing screen. Placeholder until the join flow lands in Phase 3.4. */
export default function JoinScreen() {
  const theme = useTheme();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const valid = typeof code === 'string' && CODE_PATTERN.test(code);

  return (
    <>
      <Stack.Screen options={{ title: 'Join a group' }} />
      <View style={styles.container}>
        <Text style={[styles.title, { color: theme.text }]}>You’re invited to a group</Text>
        {valid ? (
          <Text style={[styles.code, { color: theme.text, borderColor: theme.border }]}>{code.toUpperCase()}</Text>
        ) : (
          <Text style={{ color: theme.negative }}>This invite link looks incomplete.</Text>
        )}
        <Text style={{ color: theme.muted, textAlign: 'center' }}>
          Joining shared groups arrives in the next update.
        </Text>
        <Pressable onPress={() => router.replace('/')} style={[styles.button, { backgroundColor: theme.primary }]}>
          <Text style={{ color: theme.onPrimary, fontWeight: '600' }}>Go to my groups</Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  code: { fontSize: 28, fontWeight: '700', letterSpacing: 4, borderWidth: 1, borderStyle: 'dashed', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24 },
});