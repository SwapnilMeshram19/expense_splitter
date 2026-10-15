import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { MAX_NOTE_LENGTH, recordSettlement } from '@/db/repositories/settlements';
import { SETTLEMENT_METHODS, type SettlementMethod } from '@/db/schema';
import {
  formatMoney,
  minorToInputString,
  parseAmount,
  sanitizeMoneyInput,
} from '@/domain/currency';
import { loadSettleSetup, type SettleSetup } from '@/features/settlements/loadSettleSetup';
import { describeSettlementError, METHOD_LABELS } from '@/features/settlements/messages';
import { AppText } from '@/ui/AppText';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { AmountInput, FieldLabel, Input } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { MemberPicker } from '@/ui/MemberPicker';
import { Card } from '@/ui/Card';
import { useTheme } from '@/ui/theme';

type ReadySetup = Extract<SettleSetup, { ok: true }>;

interface SettleParams {
  groupId: string;
  from?: string;
  to?: string;
  /** Prefilled amount in minor units of the group currency (from a suggested payment). */
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
        <AppText color={theme.muted}>{message}</AppText>
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
  const minor = Number(params.amount);
  const amountText =
    Number.isSafeInteger(minor) && minor > 0 ? minorToInputString(minor, setup.currency) : '';
  return { fromId, toId, amountText };
}

function SettleForm({ setup, params }: { setup: ReadySetup; params: SettleParams }) {
  const theme = useTheme();
  const [initial] = useState(() => pickInitial(setup, params));
  const [fromId, setFromId] = useState(initial.fromId);
  const [toId, setToId] = useState(initial.toId);
  const [amountText, setAmountText] = useState(initial.amountText);
  // Rupee groups usually settle by UPI; others default to cash (UPI stays available: Indians
  // abroad still pay each other in rupees).
  const [method, setMethod] = useState<SettlementMethod>(setup.currency === 'INR' ? 'upi' : 'cash');
  const methods = SETTLEMENT_METHODS;
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { currency } = setup;
  const money = (minor: number) => formatMoney(minor, currency);
  const nameOf = (id: string) => setup.members.find((m) => m.id === id)?.name ?? 'Someone';
  const isMe = fromId === setup.me;
  const fromName = nameOf(fromId);

  const parsed = parseAmount(amountText, currency);
  const owes = Math.max(0, -(setup.balances.get(fromId) ?? 0));

  let hint: string | null = null;
  if (fromId === toId) hint = 'Choose two different people.';
  else if (owes === 0) hint = `${isMe ? 'You don’t' : `${fromName} doesn’t`} owe anything right now.`;
  else if (parsed.ok && parsed.minor > owes)
    hint = `That’s more than ${isMe ? 'you owe' : `${fromName} owes`} in total (${money(owes)}).`;
  else hint = `${isMe ? 'You owe' : `${fromName} owes`} ${money(owes)} in total.`;

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
      amountPaise: parsed.minor,
      method,
      note,
      actorMemberId: setup.me,
    });
    if (!result.ok) {
      setError(describeSettlementError(result.error, nameOf, currency));
      return;
    }
    router.back();
  };

  const memberPicker = (label: string, selectedId: string, onSelect: (id: string) => void) => (
    <MemberPicker
      label={label}
      members={setup.members}
      value={selectedId}
      onChange={(id) => {
        onSelect(id);
        setError(null);
      }}
    />
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Record payment' }} />
      <KeyboardAwareScrollView
        bottomOffset={62}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.card}>
          <FieldLabel>Who paid</FieldLabel>
          {memberPicker('Who paid', fromId, setFromId)}
          <View style={styles.swapRow}>
            <View style={[styles.rule, { backgroundColor: theme.border }]} />
            <Pressable
              onPress={swap}
              style={({ pressed }) => [styles.swap, { backgroundColor: theme.primarySoft, opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Swap payer and receiver"
            >
              <Icon name="settle" color={theme.onPrimarySoft} size={20} />
            </Pressable>
            <View style={[styles.rule, { backgroundColor: theme.border }]} />
          </View>
          <FieldLabel>Who received</FieldLabel>
          {memberPicker('Who received', toId, setToId)}
        </Card>

        <FieldLabel>Amount</FieldLabel>
        <AmountInput
          value={amountText}
          currency={currency}
          onChangeText={(text) => {
            setAmountText(sanitizeMoneyInput(text, amountText, currency));
            setError(null);
          }}
          autoFocus={initial.amountText === ''}
        />
        {hint ? (
          <AppText variant="label" color={theme.muted}>
            {hint}
          </AppText>
        ) : null}

        <FieldLabel>Paid via</FieldLabel>
        <View style={styles.chips}>
          {methods.map((m) => (
            <Chip key={m} label={METHOD_LABELS[m]} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </View>

        <FieldLabel>Note (optional)</FieldLabel>
        <Input
          value={note}
          onChangeText={setNote}
          placeholder="e.g. GPay ref 1234"
          maxLength={MAX_NOTE_LENGTH}
          accessibilityLabel="Note"
        />

        {error ? (
          <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
            {error}
          </AppText>
        ) : null}

        <Button label="Record payment" icon="check" size="lg" onPress={save} style={styles.submit} />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { paddingHorizontal: 20, paddingTop: 8, gap: 10, paddingBottom: 48 },
  chips: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  card: { gap: 6 },
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  swap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  submit: { marginTop: 16 },
});
