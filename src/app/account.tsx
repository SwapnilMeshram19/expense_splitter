import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { sendEmailCode, signOut, useAuth, verifyEmailCode } from '@/features/auth/authStore';
import {
  cleanOtp,
  isValidEmail,
  normalizeEmail,
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
} from '@/features/auth/messages';
import { useTheme, type Theme } from '@/ui/theme';

export default function AccountScreen() {
  const auth = useAuth();
  const theme = useTheme();

  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      {auth.status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : auth.status === 'signedIn' ? (
        <SignedIn email={auth.email} />
      ) : (
        <SignIn notice={auth.notice} />
      )}
    </>
  );
}

function SignedIn({ email }: { email: string | null }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      'Your groups stay on this phone. Sign in with the same account to use them again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const result = await signOut();
            setBusy(false);
            if (!result.ok) Alert.alert('Couldn’t sign out', result.error);
          },
        },
      ],
    );

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: theme.muted }]}>Signed in as</Text>
      <Text style={[styles.email, { color: theme.text }]}>{email ?? 'your account'}</Text>
      <Text style={{ color: theme.muted }}>
        Your groups are linked to this account. Sharing and backup across phones arrive in the next update.
      </Text>
      <Pressable
        onPress={confirmSignOut}
        disabled={busy}
        style={[styles.secondaryButton, { borderColor: theme.border, opacity: busy ? 0.6 : 1 }]}
      >
        <Text style={{ color: theme.negative, fontWeight: '600' }}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function SignIn({ notice }: { notice: string | null }) {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const send = async (target: string) => {
    setBusy(true);
    setError(null);
    const result = await sendEmailCode(target);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSentTo(target);
    setCode('');
    setCooldown(RESEND_COOLDOWN_S);
  };

  const submitEmail = () => {
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) {
      setError('Enter a valid email address.');
      return;
    }
    void send(normalized);
  };

  const verify = async (value: string) => {
    if (!sentTo || value.length !== OTP_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    const result = await verifyEmailCode(sentTo, value);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setCode('');
    }
    // On success the auth listener switches this screen to the signed-in view.
  };

  const onCodeChange = (raw: string) => {
    const next = cleanOtp(raw);
    setCode(next);
    if (next.length === OTP_LENGTH) void verify(next);
  };

  const input = inputStyle(theme);

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      {notice ? (
        <View style={[styles.notice, { backgroundColor: theme.surface, borderColor: theme.warning }]}>
          <Text style={{ color: theme.text }}>{notice}</Text>
        </View>
      ) : null}

      {sentTo === null ? (
        <>
          <Text style={[styles.title, { color: theme.text }]}>Sign in to share groups</Text>
          <Text style={{ color: theme.muted }}>
            Optional. Everything works on this phone without an account. Signing in lets you share groups
            with friends and keep a backup.
          </Text>
          <Text style={[styles.label, { color: theme.muted }]}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={submitEmail}
            maxLength={254}
            editable={!busy}
            style={input}
          />
          <PrimaryButton label="Send code" onPress={submitEmail} busy={busy} />
        </>
      ) : (
        <>
          <Text style={[styles.title, { color: theme.text }]}>Enter the code</Text>
          <Text style={{ color: theme.muted }}>
            We sent a {OTP_LENGTH}-digit code to {sentTo}. It expires in 10 minutes. Check spam if it
            doesn’t arrive within a minute.
          </Text>
          <TextInput
            value={code}
            onChangeText={onCodeChange}
            placeholder={'•'.repeat(OTP_LENGTH)}
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={OTP_LENGTH + 4} // room for pasted spaces/dashes; cleanOtp trims
            autoFocus
            editable={!busy}
            style={[input, styles.codeInput]}
          />
          <PrimaryButton
            label="Verify"
            onPress={() => void verify(code)}
            busy={busy}
            disabled={code.length !== OTP_LENGTH}
          />
          <Pressable
            onPress={() => void send(sentTo)}
            disabled={cooldown > 0 || busy}
            style={styles.linkButton}
          >
            <Text style={{ color: cooldown > 0 || busy ? theme.muted : theme.primary }}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setSentTo(null);
              setCode('');
              setError(null);
            }}
            disabled={busy}
            style={styles.linkButton}
          >
            <Text style={{ color: theme.primary }}>Use a different email</Text>
          </Pressable>
        </>
      )}

      {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}
    </KeyboardAwareScrollView>
  );
}

function PrimaryButton({
  label,
  onPress,
  busy,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const inactive = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      style={[styles.primaryButton, { backgroundColor: theme.primary, opacity: inactive ? 0.6 : 1 }]}
    >
      {busy ? (
        <ActivityIndicator color={theme.onPrimary} />
      ) : (
        <Text style={[styles.primaryText, { color: theme.onPrimary }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const inputStyle = (theme: Theme) => [
  styles.input,
  { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border },
];

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase' },
  email: { fontSize: 18, fontWeight: '500' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  codeInput: { fontSize: 28, letterSpacing: 8, textAlign: 'center' },
  notice: { borderWidth: 1, borderRadius: 10, padding: 12 },
  primaryButton: { marginTop: 8, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
  secondaryButton: { marginTop: 16, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  linkButton: { paddingVertical: 8, alignItems: 'center' },
});