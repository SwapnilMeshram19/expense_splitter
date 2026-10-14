import { eq } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { getSetting, SELF_NAME_KEY } from '@/db/repositories/profile';
import { groups } from '@/db/schema';
import { useAuth } from '@/features/auth/authStore';
import { joinGroup, previewInvite, type InvitePreview } from '@/features/invites/inviteApi';
import { describeInviteStatus, extractInviteCode, formatInviteCode } from '@/features/invites/messages';
import { syncNow } from '@/sync/syncService';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Input } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

type Phase =
  | { kind: 'enter' }
  | { kind: 'loading' }
  | { kind: 'preview'; preview: InvitePreview; notice: string | null }
  | { kind: 'finishing' }
  | { kind: 'error'; message: string };

const groupIsLocal = (groupId: string) =>
  db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).get() !== undefined;

/** Sync (which full-fetches the newly visible group), then open it. */
async function openJoinedGroup(groupId: string): Promise<boolean> {
  await syncNow();
  if (!groupIsLocal(groupId)) return false;
  router.replace({ pathname: '/groups/[groupId]', params: { groupId } });
  return true;
}

const JOINED_OFFLINE = 'You’ve joined! The group appears once you’re back online.';

export default function JoinScreen() {
  const theme = useTheme();
  const auth = useAuth();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState<string | null>(() => extractInviteCode(params.code ?? ''));
  const [phase, setPhase] = useState<Phase>({ kind: 'enter' });
  const [reload, setReload] = useState(0);
  const awaitingSignIn = useRef(false);

  // Back from the Account screen once sign-in succeeds; the preview then loads automatically.
  useEffect(() => {
    if (auth.status === 'signedIn' && awaitingSignIn.current) {
      awaitingSignIn.current = false;
      router.back();
    }
  }, [auth.status]);

  useEffect(() => {
    if (!code || auth.status !== 'signedIn') return;
    let cancelled = false;
    void (async () => {
      const result = await previewInvite(code);
      if (cancelled) return;
      if (result.ok) {
        setPhase({ kind: 'preview', preview: result.value, notice: reload > 0 ? describeInviteStatus('ALREADY_CLAIMED') : null });
        return;
      }
      if (result.error.status === 'ALREADY_MEMBER' && result.error.groupId) {
        setPhase({ kind: 'finishing' });
        if (!(await openJoinedGroup(result.error.groupId))) setPhase({ kind: 'error', message: JOINED_OFFLINE });
        return;
      }
      setPhase({ kind: 'error', message: describeInviteStatus(result.error.status) });
    })();
    return () => {
      cancelled = true;
    };
  }, [code, auth.status, reload]);

  const finish = async (groupId: string) => {
    setPhase({ kind: 'finishing' });
    if (!(await openJoinedGroup(groupId))) setPhase({ kind: 'error', message: JOINED_OFFLINE });
  };

  const tryAnother = () => {
    setCode(null);
    setReload(0);
    setPhase({ kind: 'enter' });
  };

  let body: React.ReactNode;
  if (auth.status === 'loading') {
    body = <Busy label="Loading…" />;
  } else if (auth.status === 'signedOut') {
    body = (
      <Card style={styles.card}>
        <Hero icon="lock" />
        <AppText variant="heading" style={styles.centerText}>
          Sign in to join
        </AppText>
        {code ? (
          <AppText style={[styles.code, { borderColor: theme.border }]}>{formatInviteCode(code)}</AppText>
        ) : null}
        <AppText color={theme.muted} style={styles.centerText}>
          Your groups on this phone stay as they are.
        </AppText>
        <Button
          label="Sign in"
          icon="login"
          size="lg"
          onPress={() => {
            awaitingSignIn.current = true;
            router.push('/account');
          }}
        />
      </Card>
    );
  } else if (!code) {
    body = <EnterCode onCode={setCode} />;
  } else if (phase.kind === 'loading' || phase.kind === 'enter') {
    body = <Busy label="Checking the invite…" />;
  } else if (phase.kind === 'finishing') {
    body = <Busy label="Joining…" />;
  } else if (phase.kind === 'error') {
    body = (
      <Card style={styles.card}>
        <Hero icon="warning" tone="warning" />
        <AppText style={styles.centerText}>{phase.message}</AppText>
        <Button label="Enter a different code" size="lg" onPress={tryAnother} />
        <Button label="Go to my groups" variant="secondary" onPress={() => router.replace('/')} />
      </Card>
    );
  } else {
    body = (
      <ChooseWho
        code={code}
        preview={phase.preview}
        notice={phase.notice}
        onJoined={(groupId) => void finish(groupId)}
        onClaimTaken={() => {
          setPhase({ kind: 'loading' });
          setReload((n) => n + 1);
        }}
        onError={(message) => setPhase({ kind: 'error', message })}
      />
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Join a group' }} />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {body}
      </KeyboardAwareScrollView>
    </>
  );
}

function Hero({ icon, tone = 'accent' }: { icon: 'lock' | 'warning' | 'groupAdd'; tone?: 'accent' | 'warning' }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.hero,
        { backgroundColor: tone === 'warning' ? theme.warningSoft : theme.primarySoft },
      ]}
    >
      <Icon name={icon} color={tone === 'warning' ? theme.warning : theme.onPrimarySoft} size={28} />
    </View>
  );
}

function EnterCode({ onCode }: { onCode: (code: string) => void }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (value = text) => {
    const code = extractInviteCode(value);
    if (!code) {
      setError('Not an invite code. It looks like ABCD-EFGH.');
      return;
    }
    onCode(code);
  };

  // Read only on tap: reading the clipboard unasked shows Android's "pasted" notice.
  const paste = async () => {
    const value = await Clipboard.getStringAsync();
    setText(value.trim());
    setError(null);
    if (extractInviteCode(value)) submit(value);
  };

  return (
    <Card style={styles.card}>
      <Hero icon="groupAdd" />
      <AppText variant="heading" style={styles.centerText}>
        Join a group
      </AppText>
      <AppText color={theme.muted} style={styles.centerText}>
        Paste the invite link or enter the code.
      </AppText>
      <Input
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        placeholder="ABCD-EFGH"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => submit()}
        accessibilityLabel="Invite code or link"
        style={styles.codeInput}
      />
      {error ? (
        <AppText variant="label" color={theme.negative} style={styles.centerText} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <View style={styles.row}>
        <Button label="Paste" icon="copy" variant="secondary" onPress={() => void paste()} style={styles.grow} />
        <Button label="Continue" icon="arrowForward" onPress={() => submit()} style={styles.grow} />
      </View>
    </Card>
  );
}

function ChooseWho({
  code,
  preview,
  notice,
  onJoined,
  onClaimTaken,
  onError,
}: {
  code: string;
  preview: InvitePreview;
  notice: string | null;
  onJoined: (groupId: string) => void;
  onClaimTaken: () => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const [choice, setChoice] = useState<string>(preview.placeholders.length > 0 ? '' : 'new');
  const [name, setName] = useState(() => getSetting(appContext, SELF_NAME_KEY) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (!choice) {
      setError('Choose who you are.');
      return;
    }
    if (choice === 'new' && name.trim() === '') {
      setError('Enter your name.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await joinGroup(code, choice === 'new' ? null : choice, choice === 'new' ? name.trim() : null);
    setBusy(false);
    if (result.ok) return onJoined(result.value.groupId);
    if (result.error.status === 'ALREADY_CLAIMED' || result.error.status === 'UNKNOWN_MEMBER') return onClaimTaken();
    onError(describeInviteStatus(result.error.status));
  };

  return (
    <Card style={styles.card}>
      <AppText variant="heading" style={styles.centerText} numberOfLines={2}>
        Join “{preview.groupName}”
      </AppText>
      <AppText variant="label" color={theme.muted} style={styles.centerText}>
        {preview.memberCount} {preview.memberCount === 1 ? 'person' : 'people'}
      </AppText>
      {notice ? (
        <AppText variant="label" color={theme.warning} style={styles.centerText}>
          {notice}
        </AppText>
      ) : null}

      <AppText variant="label" color={theme.muted} style={styles.label}>
        Who are you?
      </AppText>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {preview.placeholders.map((p) => (
          <Option
            key={p.id}
            label={p.displayName}
            hint="Keeps their expenses"
            selected={choice === p.id}
            onPress={() => setChoice(p.id)}
          />
        ))}
        <Option label="I’m new here" selected={choice === 'new'} onPress={() => setChoice('new')} />
      </View>

      {choice === 'new' ? (
        <Input
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          maxLength={100}
          accessibilityLabel="Your name"
        />
      ) : null}

      {error ? (
        <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
      <Button label="Join group" size="lg" onPress={() => void join()} busy={busy} />
    </Card>
  );
}

function Option({ label, hint, selected, onPress }: { label: string; hint?: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      style={[
        styles.option,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? theme.primarySoft : theme.surface,
        },
      ]}
    >
      <Icon name={selected ? 'radioOn' : 'radioOff'} color={selected ? theme.primary : theme.muted} size={22} />
      <View style={styles.grow}>
        <AppText style={selected ? styles.bold : undefined} numberOfLines={1}>
          {label}
        </AppText>
        {hint ? (
          <AppText variant="caption" color={theme.muted}>
            {hint}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

function Busy({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.busy}>
      <ActivityIndicator color={theme.primary} />
      <AppText color={theme.muted}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 48, flexGrow: 1, justifyContent: 'center' },
  card: { gap: 12, paddingVertical: 24 },
  busy: { gap: 12, alignItems: 'center' },
  hero: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  centerText: { textAlign: 'center' },
  label: { fontWeight: '600', marginTop: 4 },
  code: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: 3,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 14,
    paddingVertical: 8,
    textAlign: 'center',
  },
  codeInput: { fontSize: 20, letterSpacing: 3, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  bold: { fontWeight: '600' },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14 },
});
