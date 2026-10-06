import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { setMemberUpiVpa } from '@/db/repositories/memberUpi';
import { parseVpaInput } from '@/domain/upi';
import { loadMemberUpiSetup, type MemberUpiSetup } from '@/features/upi/loaders';
import { describeMemberUpiError } from '@/features/upi/messages';
import { useTheme } from '@/ui/theme';

type Ready = Extract<MemberUpiSetup, { ok: true }>;

export default function MemberUpiScreen() {
  const { groupId, memberId } = useLocalSearchParams<{ groupId: string; memberId: string }>();
  const theme = useTheme();
  const [setup] = useState(() => loadMemberUpiSetup(groupId, memberId));

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'UPI ID' }} />
        <Text style={{ color: theme.muted }}>{setup.message}</Text>
      </View>
    );
  }
  return <MemberUpiForm setup={setup} />;
}

function MemberUpiForm({ setup }: { setup: Ready }) {
  const theme = useTheme();
  const { member } = setup;
  const [text, setText] = useState(member.vpa ?? '');
  const [error, setError] = useState<string | null>(null);
  const title = member.isMe ? 'Your UPI ID' : `${member.name}’s UPI ID`;

  const save = (input: string | null) => {
    const result = setMemberUpiVpa(appContext, { memberId: member.id, vpaInput: input, actorMemberId: setup.me });
    if (!result.ok) {
      setError(describeMemberUpiError(result.error, member.name));
      return;
    }
    router.back();
  };

  const confirmRemove = () =>
    Alert.alert('Remove UPI ID?', 'People in this group won’t be able to pay with UPI from the app.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => save(null) },
    ]);

  if (!setup.canEdit) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title }} />
        <Text style={[styles.value, { color: theme.text }]}>{member.vpa ?? 'Not added yet'}</Text>
        <Text style={{ color: theme.muted }}>Only {member.name} can change this, since it’s linked to their account.</Text>
      </View>
    );
  }

  const parsed = text.trim() === '' ? null : parseVpaInput(text);
  const preview = parsed?.ok && parsed.vpa !== text.trim() ? parsed.vpa : null;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: theme.muted }]}>UPI ID</Text>
        <TextInput
          value={text}
          onChangeText={(value) => {
            setText(value);
            setError(null);
          }}
          placeholder="name@bank"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          keyboardType="email-address"
          maxLength={1000}
          autoFocus={member.vpa === null}
          style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
        />
        {preview ? <Text style={{ color: theme.muted }}>Will be saved as {preview}</Text> : null}
        <Text style={{ color: theme.muted }}>
          {member.isMe
            ? `People in “${setup.groupName}” use this to pay you. Only members of this group can see it.`
            : `You’re adding this for ${member.name}. Double-check it with them. Once ${member.name} joins the group, only they can change it.`}
        </Text>
        <Text style={{ color: theme.muted }}>You can also paste a UPI payment link copied from a QR code.</Text>

        {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => save(text)}
          style={({ pressed }) => [styles.submit, { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.submitText, { color: theme.onPrimary }]}>Save</Text>
        </Pressable>
        {member.vpa ? (
          <Pressable accessibilityRole="button" onPress={confirmRemove} style={styles.link}>
            <Text style={{ color: theme.negative, fontWeight: '600' }}>Remove UPI ID</Text>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase' },
  value: { fontSize: 18, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  submit: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitText: { fontSize: 16, fontWeight: '600' },
  link: { alignSelf: 'center', paddingVertical: 12 },
});