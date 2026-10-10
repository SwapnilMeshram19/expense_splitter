import * as Clipboard from 'expo-clipboard';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { recordSettlement } from '@/db/repositories/settlements';
import { formatPaise, paiseToInputString, parseRupeesToPaise, sanitizeAmountInput } from '@/domain/money';
import { buildUpiPayUri, paiseToUpiAmount, UPI_P2P_LIMIT_PAISE, UTR_PATTERN } from '@/domain/upi';
import { describeSettlementError } from '@/features/settlements/messages';
import { LinkButton, PrimaryButton } from '@/features/upi/buttons';
import { isRecentDuplicate } from '@/features/upi/duplicates';
import { hasUpiApp, openUpiApp } from '@/features/upi/launch';
import { loadPaySetup, type PaySetup } from '@/features/upi/loaders';
import {
  clearPendingUpiPayment,
  getPendingUpiPayment,
  savePendingUpiPayment,
  type PendingUpiPayment,
} from '@/features/upi/pendingUpiPayment';
import { useTheme } from '@/ui/theme';
import { Text, TextInput } from '@/ui/Text';

type Ready = Extract<PaySetup, { ok: true }>;
type Phase = 'form' | 'waiting' | 'confirm';

// Module-level (not in a component), so reading the clock here is fine for the compiler's purity rule.
function newPending(fields: Omit<PendingUpiPayment, 'startedAt'>): PendingUpiPayment {
  return { ...fields, startedAt: Date.now() };
}

export default function PayScreen() {
  const { groupId, to, amount } = useLocalSearchParams<{ groupId: string; to?: string; amount?: string }>();
  const theme = useTheme();
  const [setup, setSetup] = useState<PaySetup>(() => loadPaySetup(groupId, to));

  // Reload on focus: the payee's UPI ID may have just been added on the edit screen.
  useFocusEffect(
    useCallback(() => {
      setSetup(loadPaySetup(groupId, to));
    }, [groupId, to]),
  );

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Pay with UPI' }} />
        <Text style={{ color: theme.muted }}>{setup.message}</Text>
      </View>
    );
  }
  return <PayFlow setup={setup} groupId={groupId} suggestedPaise={Number(amount)} />;
}

function PayFlow({ setup, groupId, suggestedPaise }: { setup: Ready; groupId: string; suggestedPaise: number }) {
  const theme = useTheme();
  const { me, payee } = setup;

  // A payment started earlier to the same person (app may have been killed meanwhile) → ask first.
  const [initial] = useState(() => {
    const p = getPendingUpiPayment(appContext);
    const resumed = p && p.groupId === groupId && p.fromMemberId === me && p.toMemberId === payee.id ? p : null;
    const paise = resumed ? resumed.amountPaise : suggestedPaise;
    return {
      phase: (resumed ? 'confirm' : 'form') as Phase,
      amountText: Number.isSafeInteger(paise) && paise > 0 ? paiseToInputString(paise) : '',
    };
  });
  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [amountText, setAmountText] = useState(initial.amountText);
  const [utr, setUtr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [upiAppFound, setUpiAppFound] = useState<boolean | null>(null);

  const awaitingReturn = useRef(false);
  const leftApp = useRef(false);
  const recorded = useRef(false);

  useEffect(() => {
    let alive = true;
    void hasUpiApp().then((found) => {
      if (alive) setUpiAppFound(found);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Subscribed for the whole screen (not per phase): the app can go to background before
  // openURL resolves, and that event must not be missed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!awaitingReturn.current) return;
      if (state === 'background') leftApp.current = true;
      else if (state === 'active' && leftApp.current) {
        awaitingReturn.current = false;
        leftApp.current = false;
        setPhase('confirm');
      }
    });
    return () => sub.remove();
  }, []);

  const parsed = parseRupeesToPaise(amountText);
  const amountPaise = parsed.ok && parsed.paise > 0 ? parsed.paise : null;
  const overLimit = amountPaise !== null && amountPaise > UPI_P2P_LIMIT_PAISE;

  const onAmountChange = (text: string) => {
    setAmountText(sanitizeAmountInput(text, amountText));
    setError(null);
  };

  const remember = (paise: number) =>
    savePendingUpiPayment(
      appContext,
      newPending({ groupId, fromMemberId: me, toMemberId: payee.id, amountPaise: paise }),
    );

  const startPayment = async () => {
    if (amountPaise === null) {
      setError('Enter a valid amount.');
      return;
    }
    if (overLimit || !payee.vpa) return;
    let uri: string;
    try {
      uri = buildUpiPayUri({
        payeeVpa: payee.vpa,
        payeeName: payee.name,
        amountPaise,
        note: `Settle up ${setup.groupName}`,
      });
    } catch {
      setError(`The UPI ID saved for ${payee.name} isn’t valid.`);
      return;
    }

    remember(amountPaise);
    awaitingReturn.current = true;
    leftApp.current = false;
    setLaunching(true);
    const result = await openUpiApp(uri);
    setLaunching(false);

    if (result === 'opened') {
      setPhase((p) => (p === 'confirm' ? p : 'waiting'));
      return;
    }
    awaitingReturn.current = false;
    clearPendingUpiPayment(appContext);
    setError('No UPI app could open this payment. Copy the UPI ID below and pay from your UPI app, or record a cash payment.');
  };

  const paidAnotherWay = () => {
    if (amountPaise !== null) remember(amountPaise);
    awaitingReturn.current = false;
    setError(null);
    setPhase('confirm');
  };

  const backFromUpiApp = () => {
    awaitingReturn.current = false;
    setPhase('confirm');
  };

  const copy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    setCopied(label);
  };

  const recordPayment = () => {
    if (amountPaise === null) {
      setError('Enter the amount you paid.');
      return;
    }
    const ref = utr.replace(/\s+/g, '');
    if (ref !== '' && !UTR_PATTERN.test(ref)) {
      setError('A UPI reference number has 12 digits. Leave it blank if you don’t have it.');
      return;
    }

    const save = () => {
      if (recorded.current) return;
      const result = recordSettlement(appContext, {
        groupId,
        fromMemberId: me,
        toMemberId: payee.id,
        amountPaise,
        method: 'upi',
        note: ref ? `UPI ref ${ref}` : 'Paid via UPI',
        actorMemberId: me,
      });
      if (!result.ok) {
        setError(describeSettlementError(result.error, (id) => (id === payee.id ? payee.name : 'This person')));
        return;
      }
      recorded.current = true;
      clearPendingUpiPayment(appContext);
      router.back();
    };

    // The payee may already have recorded it on their phone.
    if (isRecentDuplicate(db, groupId, me, payee.id, amountPaise)) {
      Alert.alert(
        'Already recorded?',
        `A ${formatPaise(amountPaise)} payment from you to ${payee.name} was recorded in the last 2 days. Record this one as well?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Record anyway', onPress: save },
        ],
      );
      return;
    }
    save();
  };

  const markFailed = () => {
    clearPendingUpiPayment(appContext);
    awaitingReturn.current = false;
    setError(null);
    setUtr('');
    setPhase('form');
  };

  const amountField = (label: string) => (
    <>
      <Text style={[styles.label, { color: theme.muted }]}>{label}</Text>
      <View style={[styles.amountRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <Text style={[styles.rupee, { color: theme.muted }]}>₹</Text>
        <TextInput
          value={amountText}
          onChangeText={onAmountChange}
          placeholder="0"
          placeholderTextColor={theme.muted}
          keyboardType="decimal-pad"
          style={[styles.amountInput, { color: theme.text }]}
        />
      </View>
    </>
  );

  if (phase === 'waiting') {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Pay with UPI' }} />
        <Text style={[styles.title, { color: theme.text }]}>Finish the payment in your UPI app</Text>
        <Text style={{ color: theme.muted }}>Come back here when you’re done. We’ll ask whether it went through.</Text>
        <PrimaryButton label="I’m back" onPress={backFromUpiApp} />
      </View>
    );
  }

  if (phase === 'confirm') {
    return (
      <>
        <Stack.Screen options={{ title: 'Confirm payment' }} />
        <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: theme.text }]}>Did the payment to {payee.name} go through?</Text>
          <Text style={{ color: theme.muted }}>
            Check the success screen in your UPI app or your bank’s debit SMS. If it says “pending”, choose
            “Not sure yet” and you’ll be reminded on the group screen.
          </Text>
          {amountField('Amount paid')}
          <Text style={[styles.label, { color: theme.muted }]}>UPI reference no. (optional)</Text>
          <TextInput
            value={utr}
            onChangeText={(v) => {
              setUtr(v);
              setError(null);
            }}
            placeholder="12 digits"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            maxLength={16}
            style={[styles.input, { color: theme.text, backgroundColor: theme.surface, borderColor: theme.border }]}
          />
          {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}
          <PrimaryButton
            label={amountPaise ? `Yes, record ${formatPaise(amountPaise)} paid` : 'Yes, record payment'}
            onPress={recordPayment}
          />
          <LinkButton label="No, it failed or I cancelled" onPress={markFailed} color={theme.negative} />
          <LinkButton label="Not sure yet" onPress={() => router.back()} color={theme.muted} />
        </KeyboardAwareScrollView>
        <KeyboardToolbar />
      </>
    );
  }

  let hint: string;
  if (setup.myDebtPaise === 0) hint = 'You don’t owe anything right now.';
  else if (amountPaise !== null && amountPaise > setup.myDebtPaise)
    hint = `That’s more than you owe in total (${formatPaise(setup.myDebtPaise)}).`;
  else hint = `You owe ${formatPaise(setup.myDebtPaise)} in total. Paying part of it is fine.`;

  return (
    <>
      <Stack.Screen options={{ title: 'Pay with UPI' }} />
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.text }]}>Pay {payee.name}</Text>
        {payee.vpa ? <Text style={{ color: theme.muted }}>UPI ID: {payee.vpa}</Text> : null}

        {amountField('Amount')}
        <Text style={{ color: theme.muted }}>{hint}</Text>

        {overLimit ? (
          <View style={styles.block}>
            <Text style={{ color: theme.negative }}>
              UPI allows up to {formatPaise(UPI_P2P_LIMIT_PAISE)} per payment (your bank may allow less). Pay in
              parts. Each part is recorded separately.
            </Text>
            <LinkButton
              label={`Pay ${formatPaise(UPI_P2P_LIMIT_PAISE)} now`}
              onPress={() => setAmountText(paiseToInputString(UPI_P2P_LIMIT_PAISE))}
            />
          </View>
        ) : null}

        {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}

        {payee.vpa ? (
          <>
            <PrimaryButton
              label={launching ? 'Opening…' : amountPaise ? `Pay ${formatPaise(amountPaise)} with UPI app` : 'Pay with UPI app'}
              onPress={() => void startPayment()}
              disabled={launching || overLimit || amountPaise === null}
            />
            {upiAppFound === false ? (
              <Text style={{ color: theme.warning }}>No UPI app detected on this phone. Try anyway, or copy the details below.</Text>
            ) : null}
            <Text style={{ color: theme.muted }}>
              Your UPI app shows the name registered with {payee.name}’s bank. If it doesn’t look right, don’t pay.
            </Text>

            <Text style={[styles.label, { color: theme.muted }]}>UPI app not working?</Text>
            <View style={styles.row}>
              <LinkButton label="Copy UPI ID" onPress={() => void copy(payee.vpa!, 'UPI ID')} />
              {amountPaise && !overLimit ? (
                <LinkButton label="Copy amount" onPress={() => void copy(paiseToUpiAmount(amountPaise), 'Amount')} />
              ) : null}
            </View>
            {copied ? <Text style={{ color: theme.muted }}>{copied} copied.</Text> : null}
            <LinkButton label="I’ve paid another way, record it" onPress={paidAnotherWay} />
          </>
        ) : (
          <View style={styles.block}>
            <Text style={{ color: theme.text }}>
              {payee.storedVpaInvalid
                ? `The UPI ID saved for ${payee.name} isn’t valid.`
                : `${payee.name} hasn’t added a UPI ID in this group.`}
            </Text>
            {payee.canEditVpa ? (
              <LinkButton
                label={`Add ${payee.name}’s UPI ID`}
                onPress={() =>
                  router.push({
                    pathname: '/groups/[groupId]/members/[memberId]/upi',
                    params: { groupId, memberId: payee.id },
                  })
                }
              />
            ) : (
              <Text style={{ color: theme.muted }}>Ask {payee.name} to add it. Only they can, since it’s linked to their account.</Text>
            )}
            <LinkButton
              label="Paid in cash or another way? Record it"
              onPress={() =>
                router.replace({
                  pathname: '/groups/[groupId]/settle',
                  params: { groupId, from: me, to: payee.id, ...(amountPaise ? { amount: String(amountPaise) } : {}) },
                })
              }
            />
          </View>
        )}
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 },
  rupee: { fontSize: 28, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 34, fontWeight: '700', paddingVertical: 10 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, minHeight: 48, paddingVertical: 10, fontSize: 16 },
  row: { flexDirection: 'row', gap: 20 },
  block: { gap: 6, marginTop: 8 },
});