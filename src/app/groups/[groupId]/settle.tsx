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
import { useTheme } from '@/ui/theme';
import { Text } from '@/ui/Text';

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
  // UPI only moves rupees: other groups default to cash and don't offer it.
  const [method, setMethod] = useState<SettlementMethod>(setup.currency === 'INR' ? 'upi' : 'cash');
  const methods = SETTLEMENT_METHODS.filter((m) => m !== 'upi' || setup.currency === 'INR');
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
        <FieldLabel>Who paid</FieldLabel>
        {memberPicker('Who paid', fromId, setFromId)}

        <Pressable onPress={swap} style={styles.swap} accessibilityRole="button" accessibilityLabel="Swap payer and receiver" hitSlop={8}>
          <Icon name="settle" color={theme.onPrimarySoft} size={18} />
          <AppText variant="label" color={theme.onPrimarySoft} style={styles.bold}>
            Swap
          </AppText>
        </Pressable>

        <FieldLabel>Who received</FieldLabel>
        {memberPicker('Who received', toId, setToId)}

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

        <Button label="Record payment" size="lg" onPress={save} style={styles.submit} />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { paddingHorizontal: 20, paddingTop: 8, gap: 10, paddingBottom: 48 },
  chips: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  swap: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 40 },
  bold: { fontWeight: '600' },
  submit: { marginTop: 16 },
});
