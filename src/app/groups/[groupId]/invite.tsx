import { eq } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { db } from '@/db/client';
import { useLiveData } from '@/db/hooks/useLiveData';
import { groups } from '@/db/schema';
import { useAuth } from '@/features/auth/authStore';
import { createInvite, revokeAllInvites, type CreatedInvite } from '@/features/invites/inviteApi';
import { buildShareMessage, describeInviteStatus, formatInviteCode } from '@/features/invites/messages';
import { syncNow } from '@/sync/syncService';
import { useTheme } from '@/ui/theme';
import { Text } from '@/ui/Text';

const readGroup = (groupId: string) => db.select().from(groups).where(eq(groups.id, groupId)).get() ?? null;

function expiryLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'in 7 days'
    : `on ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

export default function InviteScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const auth = useAuth();
  const group = useLiveData(['groups'], useCallback(() => readGroup(groupId), [groupId]));
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!group) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Invite people' }} />
        <Text style={{ color: theme.muted }}>This group no longer exists.</Text>
      </View>
    );
  }

  if (auth.status !== 'signedIn') {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Invite people' }} />
        <Text style={[styles.title, { color: theme.text }]}>Sign in to share this group</Text>
        <Text style={{ color: theme.muted, textAlign: 'center' }}>
          Shared groups need an account so everyone sees the same expenses.
        </Text>
        <Pressable onPress={() => router.push('/account')} style={[styles.primaryButton, { backgroundColor: theme.primary }]}>
          <Text style={{ color: theme.onPrimary, fontWeight: '600' }}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  const create = async () => {
    setBusy(true);
    setMessage(null);
    // The server only knows groups that have synced at least once.
    if (group.version === 0) {
      await syncNow();
      if ((readGroup(groupId)?.version ?? 0) === 0) {
        setBusy(false);
        setMessage('This group hasn’t uploaded yet. Check your internet connection and try again.');
        return;
      }
    }
    const result = await createInvite(groupId);
    setBusy(false);
    if (result.ok) setInvite(result.value);
    else setMessage(describeInviteStatus(result.error.status));
  };

  const share = async () => {
    if (!invite) return;
    await Share.share({ message: buildShareMessage(group.name, invite.code) });
  };

  const revoke = () =>
    Alert.alert(
      'Stop all invite links?',
      'Links and codes already sent will stop working. People already in the group stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop links',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const result = await revokeAllInvites(groupId);
            setBusy(false);
            if (result.ok) {
              setInvite(null);
              setMessage(result.value === 0 ? 'There were no active links.' : 'All invite links have been stopped.');
            } else {
              setMessage(describeInviteStatus(result.error.status));
            }
          },
        },
      ],
    );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Invite people' }} />

      <Text style={[styles.title, { color: theme.text }]}>Invite people to “{group.name}”</Text>
      <Text style={{ color: theme.muted }}>
        Anyone with the link can see the group name and the names of people not yet joined, and join the
        group. Links work for 7 days and up to 20 people.
      </Text>

      {invite ? (
        <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Text style={[styles.code, { color: theme.text }]}>{formatInviteCode(invite.code)}</Text>
          <Text style={{ color: theme.muted, textAlign: 'center' }}>Expires {expiryLabel(invite.expiresAt)}</Text>
          <Pressable onPress={() => void share()} style={[styles.primaryButton, { backgroundColor: theme.primary }]}>
            <Text style={{ color: theme.onPrimary, fontWeight: '600' }}>Share link</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => void create()}
          disabled={busy}
          style={[styles.primaryButton, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}
        >
          {busy ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <Text style={{ color: theme.onPrimary, fontWeight: '600' }}>Create invite link</Text>
          )}
        </Pressable>
      )}

      {message ? <Text style={{ color: theme.text, textAlign: 'center' }}>{message}</Text> : null}

      <Pressable onPress={revoke} disabled={busy} style={styles.linkButton}>
        <Text style={{ color: theme.negative }}>Stop all invite links</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 10, marginTop: 8 },
  code: { fontSize: 30, fontWeight: '700', letterSpacing: 4, textAlign: 'center' },
  primaryButton: { borderRadius: 25, minHeight: 50, justifyContent: 'center', paddingHorizontal: 24, alignItems: 'center', marginTop: 8 },
  linkButton: { paddingVertical: 12, alignItems: 'center' },
});