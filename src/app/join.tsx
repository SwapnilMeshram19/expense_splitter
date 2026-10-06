import { eq } from 'drizzle-orm';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { getSetting, SELF_NAME_KEY } from '@/db/repositories/profile';
import { groups } from '@/db/schema';
import { useAuth } from '@/features/auth/authStore';
import { joinGroup, previewInvite, type InvitePreview } from '@/features/invites/inviteApi';
import { describeInviteStatus, extractInviteCode, formatInviteCode } from '@/features/invites/messages';
import { syncNow } from '@/sync/syncService';
import { useTheme, type Theme } from '@/ui/theme';

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

const JOINED_OFFLINE =
  'You’ve joined! The group will appear in your list as soon as this phone syncs. Check your internet connection.';

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
      <View style={styles.block}>
        <Text style={[styles.title, { color: theme.text }]}>Sign in to join</Text>
        {code ? (
          <Text style={[styles.code, { color: theme.text, borderColor: theme.border }]}>{formatInviteCode(code)}</Text>
        ) : null}
        <Text style={{ color: theme.muted, textAlign: 'center' }}>
          Shared groups need an account so everyone sees the same expenses. Your groups on this phone stay as they are.
        </Text>
        <PrimaryButton
          label="Sign in"
          onPress={() => {
            awaitingSignIn.current = true;
            router.push('/account');
          }}
        />
      </View>
    );
  } else if (!code) {
    body = <EnterCode onCode={setCode} />;
  } else if (phase.kind === 'loading' || phase.kind === 'enter') {
    body = <Busy label="Checking the invite…" />;
  } else if (phase.kind === 'finishing') {
    body = <Busy label="Joining and downloading the group…" />;
  } else if (phase.kind === 'error') {
    body = (
      <View style={styles.block}>
        <Text style={{ color: theme.negative, textAlign: 'center', fontSize: 16 }}>{phase.message}</Text>
        <PrimaryButton label="Enter a different code" onPress={tryAnother} />
        <Pressable onPress={() => router.replace('/')} style={styles.linkButton}>
          <Text style={{ color: theme.primary }}>Go to my groups</Text>
        </Pressable>
      </View>
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

function EnterCode({ onCode }: { onCode: (code: string) => void }) {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const code = extractInviteCode(text);
    if (!code) {
      setError('That doesn’t look like an invite code. It has 8 letters and numbers, like ABCD-EFGH.');
      return;
    }
    onCode(code);
  };

  return (
    <View style={styles.block}>
      <Text style={[styles.title, { color: theme.text }]}>Join a group</Text>
      <Text style={{ color: theme.muted, textAlign: 'center' }}>
        Paste the invite message or link, or type the 8-character code.
      </Text>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        placeholder="ABCD-EFGH"
        placeholderTextColor={theme.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={submit}
        style={[inputStyle(theme), styles.codeInput]}
      />
      {error ? <Text style={{ color: theme.negative, textAlign: 'center' }}>{error}</Text> : null}
      <PrimaryButton label="Continue" onPress={submit} />
    </View>
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
      setError('Choose who you are in this group.');
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
    <View style={styles.block}>
      <Text style={[styles.title, { color: theme.text }]}>Join “{preview.groupName}”</Text>
      <Text style={{ color: theme.muted }}>
        {preview.memberCount} {preview.memberCount === 1 ? 'person' : 'people'} in this group.
      </Text>
      {notice ? <Text style={{ color: theme.warning, textAlign: 'center' }}>{notice}</Text> : null}

      <Text style={[styles.label, { color: theme.muted }]}>Who are you?</Text>
      {preview.placeholders.map((p) => (
        <Option
          key={p.id}
          label={`I’m ${p.displayName}`}
          hint="Keeps the expenses already added for this person"
          selected={choice === p.id}
          onPress={() => setChoice(p.id)}
        />
      ))}
      <Option label="I’m new to this group" selected={choice === 'new'} onPress={() => setChoice('new')} />

      {choice === 'new' ? (
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={theme.muted}
          maxLength={100}
          style={inputStyle(theme)}
        />
      ) : null}

      {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}
      <PrimaryButton label="Join group" onPress={() => void join()} busy={busy} />
    </View>
  );
}

function Option({ label, hint, selected, onPress }: { label: string; hint?: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.option, { borderColor: selected ? theme.primary : theme.border, backgroundColor: theme.surface }]}
    >
      <Text style={{ color: theme.text, fontWeight: selected ? '600' : '400', fontSize: 16 }}>
        {selected ? '● ' : '○ '}
        {label}
      </Text>
      {hint ? <Text style={{ color: theme.muted, fontSize: 13 }}>{hint}</Text> : null}
    </Pressable>
  );
}

function Busy({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.block}>
      <ActivityIndicator color={theme.primary} />
      <Text style={{ color: theme.muted }}>{label}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, busy = false }: { label: string; onPress: () => void; busy?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={[styles.primaryButton, { backgroundColor: theme.primary, opacity: busy ? 0.6 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator color={theme.onPrimary} />
      ) : (
        <Text style={{ color: theme.onPrimary, fontSize: 16, fontWeight: '600' }}>{label}</Text>
      )}
    </Pressable>
  );
}

const inputStyle = (theme: Theme) => [
  styles.input,
  { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
];

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, flexGrow: 1, justifyContent: 'center' },
  block: { gap: 12, alignItems: 'stretch' },
  title: { fontSize: 20, fontWeight: '600', textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase' },
  code: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 4,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 8,
    textAlign: 'center',
  },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  codeInput: { fontSize: 22, letterSpacing: 3, textAlign: 'center' },
  option: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 2 },
  primaryButton: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  linkButton: { paddingVertical: 8, alignItems: 'center' },
});