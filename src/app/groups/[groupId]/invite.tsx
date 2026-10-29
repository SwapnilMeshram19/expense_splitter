import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { dataStore } from '@/data';
import { useData } from '@/data/hooks';
import { hasAccount, useAuth } from '@/features/auth/authStore';
import { createInvite, revokeAllInvites, type CreatedInvite } from '@/features/invites/inviteApi';
import {
  buildShareMessage,
  describeInviteStatus,
  formatInviteCode,
  inviteUrl,
} from '@/features/invites/messages';
import { copyText } from '@/features/share/copyText';
import { ShareButtons } from '@/features/share/ShareButtons';
import { QrCode } from '@/features/upi/QrCode';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';


function expiryLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'in 7 days'
    : date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function InviteScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const theme = useTheme();
  const auth = useAuth();
  const group = useData(() => dataStore().group(groupId)?.group ?? null, [groupId]);
  const notSentYet = useData(() => dataStore().pendingStatus(groupId) !== null, [groupId]);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!group) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Invite' }} />
        <AppText color={theme.muted}>This group no longer exists.</AppText>
      </View>
    );
  }

  if (!hasAccount(auth) || notSentYet) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Stack.Screen options={{ title: 'Invite' }} />
        <Card style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: theme.primarySoft }]}>
            <Icon name="cloudOff" color={theme.onPrimarySoft} size={28} />
          </View>
          <AppText variant="heading" style={styles.centerText}>
            Connect to invite
          </AppText>
          <AppText color={theme.muted} style={styles.centerText}>
            This group uploads as soon as you’re online. Then you can invite people.
          </AppText>
        </Card>
      </ScrollView>
    );
  }

  const create = async () => {
    setBusy(true);
    setMessage(null);
    const result = await createInvite(groupId);
    setBusy(false);
    if (result.ok) setInvite(result.value);
    else setMessage(describeInviteStatus(result.error.status));
  };

  const revoke = () =>
    Alert.alert('Stop all invite links?', 'Links already sent stop working. Members stay.', [
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
            setMessage(result.value === 0 ? 'No active links.' : 'All links stopped.');
          } else {
            setMessage(describeInviteStatus(result.error.status));
          }
        },
      },
    ]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Invite' }} />

      {invite ? (
        <Card style={styles.hero}>
          <AppText variant="heading" style={styles.centerText} numberOfLines={2}>
            Join “{group.name}”
          </AppText>
          <QrCode value={inviteUrl(invite.code)} size={176} label="Invite QR code" />
          <View style={styles.codeBlock}>
            <AppText variant="caption" color={theme.muted} style={styles.centerText}>
              Scan, or enter code
            </AppText>
            <AppText style={styles.code} selectable>
              {formatInviteCode(invite.code)}
            </AppText>
            <AppText variant="caption" color={theme.muted} style={styles.centerText}>
              Expires {expiryLabel(invite.expiresAt)} · up to 20 people
            </AppText>
          </View>
          <ShareButtons
            label="WhatsApp"
            accessibilityLabel="Send the invite on WhatsApp"
            getText={() => buildShareMessage(group.name, invite.code)}
            style={styles.stretch}
          />
          <View style={[styles.row, styles.stretch]}>
            <Button
              label="Copy link"
              icon="link"
              variant="secondary"
              onPress={() => void copyText(inviteUrl(invite.code), 'Link copied')}
              style={styles.grow}
            />
            <Button
              label="Copy code"
              icon="copy"
              variant="secondary"
              onPress={() => void copyText(formatInviteCode(invite.code), 'Code copied')}
              style={styles.grow}
            />
          </View>
        </Card>
      ) : (
        <Card style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: theme.primarySoft }]}>
            <Icon name="personAdd" color={theme.onPrimarySoft} size={28} />
          </View>
          <AppText variant="heading" style={styles.centerText} numberOfLines={2}>
            Invite to “{group.name}”
          </AppText>
          <AppText color={theme.muted} style={styles.centerText}>
            Anyone with the link can join. Valid 7 days.
          </AppText>
          <Button
            label="Create invite link"
            icon="link"
            size="lg"
            busy={busy}
            onPress={() => void create()}
            style={styles.stretch}
          />
        </Card>
      )}

      {message ? (
        <AppText color={theme.text} style={styles.centerText} accessibilityLiveRegion="polite">
          {message}
        </AppText>
      ) : null}

      <Button label="Stop all invite links" variant="danger" disabled={busy} onPress={revoke} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  hero: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  heroIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  codeBlock: { gap: 2, alignItems: 'center' },
  code: { fontSize: 28, lineHeight: 36, fontWeight: '700', letterSpacing: 3 },
  stretch: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
});
