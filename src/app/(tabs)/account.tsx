import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import {
  sendEmailCode,
  signInWithGoogle,
  signOut,
  useAuth,
  verifyEmailCode,
} from '@/features/auth/authStore';
import {
  cleanOtp,
  isValidEmail,
  normalizeEmail,
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
} from '@/features/auth/messages';
import { GoogleButton } from '@/features/auth/GoogleButton';
import { useMyProfile } from '@/features/auth/useMyProfile';
import { SyncPanel } from '@/sync/SyncPanel';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { Icon, type IconName } from '@/ui/Icon';
import { ACCENT_IDS, ACCENTS, type AccentId } from '@/ui/palette';
import { Segmented } from '@/ui/Segmented';
import { TabHeader } from '@/ui/TabHeader';
import { useTheme } from '@/ui/theme';
import { setAccent, setThemeMode, useThemePreference, type ThemeMode } from '@/ui/themePreference';

import { isGoogleSignInAvailable } from '../../../modules/google-credential';

const PRIVACY_URL = 'https://split.ssoftapp.in/privacy/';
const SUPPORT_EMAIL = 'support@ssoftapp.in';

const THEME_OPTIONS: readonly { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function AccountTab() {
  const auth = useAuth();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <TabHeader title="Account" hideAvatar />
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {auth.status === 'loading' ? (
          <Card style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </Card>
        ) : auth.status === 'signedIn' ? (
          <ProfileCard />
        ) : (
          <SignInCard notice={auth.notice} />
        )}
        <AppearanceCard />
        <LinksCard signedIn={auth.status === 'signedIn'} />
        <AppText variant="caption" color={theme.muted} style={styles.version}>
          Expense Splitter · version {Constants.expoConfig?.version ?? '—'} · ssoftapp.in
        </AppText>
      </KeyboardAwareScrollView>
    </View>
  );
}

function ProfileCard() {
  const theme = useTheme();
  const me = useMyProfile();

  return (
    <Card style={styles.card}>
      <View style={styles.profileRow}>
        <Avatar seed={me.id} name={me.name ?? '?'} photoUrl={me.photoUrl} size={60} />
        <View style={styles.grow}>
          <AppText variant="heading" numberOfLines={1}>
            {me.name ?? 'Your account'}
          </AppText>
          {me.email ? (
            <AppText variant="label" color={theme.muted} numberOfLines={1}>
              {me.email}
            </AppText>
          ) : null}
          <AppText variant="caption" color={theme.muted}>
            Groups are backed up and synced on every phone you sign in on.
          </AppText>
        </View>
      </View>
      <SyncPanel compact />
    </Card>
  );
}

function AppearanceCard() {
  const theme = useTheme();
  const preference = useThemePreference();

  return (
    <Card style={styles.card}>
      <AppText variant="heading" accessibilityRole="header">
        Appearance
      </AppText>
      <View style={styles.field}>
        <AppText variant="label" color={theme.muted}>
          Theme
        </AppText>
        <Segmented
          options={THEME_OPTIONS}
          value={preference.mode}
          onChange={(mode) => setThemeMode(appContext, mode)}
          accessibilityLabel="Theme"
        />
      </View>
      <View style={styles.field}>
        <AppText variant="label" color={theme.muted}>
          Accent colour
        </AppText>
        <View accessibilityRole="radiogroup" accessibilityLabel="Accent colour" style={styles.swatches}>
          {ACCENT_IDS.map((id) => (
            <AccentSwatch key={id} id={id} selected={preference.accent === id} />
          ))}
        </View>
      </View>
    </Card>
  );
}

function AccentSwatch({ id, selected }: { id: AccentId; selected: boolean }) {
  const theme = useTheme();
  // Show each accent in the current scheme's shade, so the swatch matches what you'll get.
  const color = ACCENTS[id][theme.scheme].primary;
  return (
    <Pressable
      onPress={() => setAccent(appContext, id)}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={ACCENTS[id].label}
      // Selection ring: an outer border in the accent with a gap in the card colour.
      style={[styles.swatchRing, { borderColor: selected ? color : 'transparent' }]}
    >
      <View style={[styles.swatch, { backgroundColor: color, borderColor: theme.surface }]}>
        {selected ? <Icon name="check" color={ACCENTS[id][theme.scheme].onPrimary} size={20} /> : null}
      </View>
    </Pressable>
  );
}

function LinksCard({ signedIn }: { signedIn: boolean }) {
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
    <Card style={styles.linksCard}>
      <LinkRow icon="shield" label="Privacy policy" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)} />
      <LinkRow
        icon="help"
        label="Help & support"
        detail={SUPPORT_EMAIL}
        onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        last={!signedIn}
      />
      {signedIn ? <LinkRow icon="logout" label="Sign out" danger busy={busy} onPress={confirmSignOut} last /> : null}
    </Card>
  );
}

function LinkRow({
  icon,
  label,
  detail,
  onPress,
  danger = false,
  busy = false,
  last = false,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
  busy?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  const color = danger ? theme.negative : theme.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.linkRow,
        !last && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: busy ? 0.5 : pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} color={color} size={20} />
      <AppText color={color} style={[styles.grow, danger && styles.dangerText]}>
        {label}
      </AppText>
      {detail ? (
        <AppText variant="label" color={theme.muted} numberOfLines={1}>
          {detail}
        </AppText>
      ) : null}
      {!danger ? <Icon name="chevronRight" color={theme.muted} size={18} /> : null}
    </Pressable>
  );
}

function SignInCard({ notice }: { notice: string | null }) {
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

  const google = async () => {
    setBusy(true);
    setError(null);
    const result = await signInWithGoogle();
    setBusy(false);
    // error === null means the user dismissed the chooser: not worth a message.
    if (!result.ok && result.error) setError(result.error);
  };

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
    // On success the auth listener switches this card to the profile view.
  };

  const onCodeChange = (raw: string) => {
    const next = cleanOtp(raw);
    setCode(next);
    if (next.length === OTP_LENGTH) void verify(next);
  };

  const input = [
    styles.input,
    { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border, fontFamily: theme.fontFamily },
  ];

  return (
    <Card style={styles.card}>
      {notice ? (
        <View style={[styles.notice, { backgroundColor: theme.warningSoft }]}>
          <AppText variant="label" color={theme.warning}>
            {notice}
          </AppText>
        </View>
      ) : null}

      {sentTo === null ? (
        <>
          <AppText variant="heading" accessibilityRole="header">
            Sign in to share groups
          </AppText>
          <AppText variant="label" color={theme.muted}>
            Optional. Everything works on this phone without an account. Signing in lets you share
            groups with friends and keep a backup.
          </AppText>

          {isGoogleSignInAvailable ? (
            <>
              <GoogleButton onPress={() => void google()} busy={busy} />
              <AppText variant="caption" color={theme.muted} style={styles.divider}>
                or use email
              </AppText>
            </>
          ) : null}

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
            accessibilityLabel="Email"
            style={input}
          />
          <Button label="Send code" size="lg" onPress={submitEmail} busy={busy} />
        </>
      ) : (
        <>
          <AppText variant="heading" accessibilityRole="header">
            Enter the code
          </AppText>
          <AppText variant="label" color={theme.muted}>
            We sent a {OTP_LENGTH}-digit code to {sentTo}. It expires in 10 minutes. Check spam if it
            doesn’t arrive within a minute.
          </AppText>
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
            accessibilityLabel="Sign-in code"
            style={[input, styles.codeInput]}
          />
          <Button
            label="Verify"
            size="lg"
            onPress={() => void verify(code)}
            busy={busy}
            disabled={code.length !== OTP_LENGTH}
          />
          <View style={styles.otpLinks}>
            <Pressable onPress={() => void send(sentTo)} disabled={cooldown > 0 || busy} hitSlop={8}>
              <AppText variant="label" color={cooldown > 0 || busy ? theme.muted : theme.onPrimarySoft}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => {
                setSentTo(null);
                setCode('');
                setError(null);
              }}
              disabled={busy}
              hitSlop={8}
            >
              <AppText variant="label" color={theme.onPrimarySoft}>
                Use a different email
              </AppText>
            </Pressable>
          </View>
        </>
      )}

      {error ? (
        <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  center: { alignItems: 'center', paddingVertical: 32 },
  card: { gap: 14 },
  grow: { flex: 1, minWidth: 0 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  field: { gap: 8 },
  swatches: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  swatchRing: { width: 48, height: 48, borderRadius: 24, borderWidth: 2 },
  swatch: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linksCard: { paddingVertical: 4, paddingHorizontal: 16 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  dangerText: { fontWeight: '500' },
  version: { textAlign: 'center', marginTop: 4 },
  notice: { borderRadius: 12, padding: 12 },
  divider: { textAlign: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  codeInput: { fontSize: 28, letterSpacing: 8, textAlign: 'center' },
  otpLinks: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
});
