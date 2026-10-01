import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { MAX_NOTE_LENGTH, recordSettlement } from '@/db/repositories/settlements';
import { SETTLEMENT_METHODS, type SettlementMethod } from '@/db/schema';
import {
  formatPaise,
  paiseToInputString,
  parseRupeesToPaise,
  sanitizeAmountInput,
} from '@/domain/money';
import { loadSettleSetup, type SettleSetup } from '@/features/settlements/loadSettleSetup';
import { describeSettlementError, METHOD_LABELS } from '@/features/settlements/messages';
import { Chip } from '@/ui/Chip';
import { useTheme } from '@/ui/theme';

type ReadySetup = Extract<SettleSetup, { ok: true }>;

interface SettleParams {
  groupId: string;
  from?: string;
  to?: string;
  /** Prefilled amount in paise (from a suggested payment). */
  amount?: string;
}

export default function SettleScreen() {
  const params = useLocalSearchParams<{ groupId: string; from?: string; to?: string; amount?: string }>();
  const theme = useTheme();
  const setup = useMemo(() => loadSettleSetup(params.groupId), [params.groupId]);

  const message = !setup.ok
    ? setup.message
    : setup.members.length < 2
      ? 'Add another person to this group first.'
      : null;

  if (!setup.ok || message) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Record payment' }} />
        <Text style={{ color: theme.muted }}>{message}</Text>
      </View>
    );
  }

  return <SettleForm setup={setup} params={params} />;
}

function pickInitial(setup: ReadySetup, params: SettleParams) {
  const ids = setup.members.map((m) => m.id);
  const fromId = params.from && ids.includes(params.from) ? params.from : setup.me;
  const toId =
    params.to && ids.includes(params.to) && params.to !== fromId
      ? params.to
      : (ids.find((id) => id !== fromId) ?? fromId);
  const paise = Number(params.amount);
  const amountText = Number.isSafeInteger(paise) && paise > 0 ? paiseToInputString(paise) : '';
  return { fromId, toId, amountText };
}

function SettleForm({ setup, params }: { setup: ReadySetup; params: SettleParams }) {
  const theme = useTheme();
  const [initial] = useState(() => pickInitial(setup, params));
  const [fromId, setFromId] = useState(initial.fromId);
  const [toId, setToId] = useState(initial.toId);
  const [amountText, setAmountText] = useState(initial.amountText);
  const [method, setMethod] = useState<SettlementMethod>('upi');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';
  const isMe = fromId === setup.me;
  const fromName = nameOf(fromId);

  const parsed = parseRupeesToPaise(amountText);
  const owes = Math.max(0, -(setup.balances.get(fromId) ?? 0));

  let hint: string | null = null;
  if (fromId === toId) hint = 'Choose two different people.';
  else if (owes === 0) hint = `${isMe ? 'You don’t' : `${fromName} doesn’t`} owe anything right now.`;
  else if (parsed.ok && parsed.paise > owes)
    hint = `That’s more than ${isMe ? 'you owe' : `${fromName} owes`} in total (${formatPaise(owes)}).`;
  else hint = `${isMe ? 'You owe' : `${fromName} owes`} ${formatPaise(owes)} in total.`;

  const swap = () => {
    setFromId(toId);
    setToId(fromId);
    setError(null);
  };

  const save = () => {
    if (!parsed.ok) {
      setError('Enter a valid amount.');
      return;
    }
    const result = recordSettlement(appContext, {
      groupId: params.groupId,
      fromMemberId: fromId,
      toMemberId: toId,
      amountPaise: parsed.paise,
      method,
      note,
      actorMemberId: setup.me,
    });
    if (!result.ok) {
      setError(describeSettlementError(result.error, nameOf));
      return;
    }
    router.back();
  };

  const memberChips = (selectedId: string, onSelect: (id: string) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {setup.members.map((m) => (
        <Chip
          key={m.id}
          label={m.name}
          selected={selectedId === m.id}
          onPress={() => {
            onSelect(m.id);
            setError(null);
          }}
        />
      ))}
    </ScrollView>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Record payment' }} />
      <KeyboardAwareScrollView
        bottomOffset={62}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.label, { color: theme.muted }]}>Who paid</Text>
        {memberChips(fromId, setFromId)}

        <Pressable onPress={swap} style={styles.swap} accessibilityRole="button" accessibilityLabel="Swap">
          <Text style={{ color: theme.primary, fontWeight: '600' }}>⇅ Swap</Text>
        </Pressable>

        <Text style={[styles.label, { color: theme.muted }]}>Who received</Text>
        {memberChips(toId, setToId)}

        <Text style={[styles.label, { color: theme.muted }]}>Amount</Text>
        <View style={[styles.amountRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Text style={[styles.rupee, { color: theme.muted }]}>₹</Text>
          <TextInput
            value={amountText}
            onChangeText={(text) => {
              setAmountText(sanitizeAmountInput(text, amountText));
              setError(null);
            }}
            placeholder="0"
            placeholderTextColor={theme.muted}
            keyboardType="decimal-pad"
            style={[styles.amountInput, { color: theme.text }]}
            autoFocus={initial.amountText === ''}
          />
        </View>
        {hint ? <Text style={{ color: theme.muted }}>{hint}</Text> : null}

        <Text style={[styles.label, { color: theme.muted }]}>Paid via</Text>
        <View style={styles.chips}>
          {SETTLEMENT_METHODS.map((m) => (
            <Chip key={m} label={METHOD_LABELS[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>

        <Text style={[styles.label, { color: theme.muted }]}>Note (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. GPay ref 1234"
          placeholderTextColor={theme.muted}
          maxLength={MAX_NOTE_LENGTH}
          style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
        />

        {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          onPress={save}
          style={({ pressed }) => [styles.submit, { backgroundColor: theme.primary, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.submitText, { color: theme.onPrimary }]}>Record payment</Text>
        </Pressable>
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  swap: { alignSelf: 'flex-start', paddingVertical: 4 },
  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  rupee: { fontSize: 28, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 32, fontWeight: '600', paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  submit: { marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitText: { fontSize: 16, fontWeight: '600' },
});