import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { recordSettlement } from '@/db/repositories/settlements';
import { formatPaise, paiseToInputString, parseRupeesToPaise, sanitizeAmountInput } from '@/domain/money';
import { buildUpiPayUri, UPI_P2P_LIMIT_PAISE } from '@/domain/upi';
import { describeSettlementError } from '@/features/settlements/messages';
import { LinkButton, PrimaryButton } from '@/features/upi/buttons';
import { isRecentDuplicate } from '@/features/upi/duplicates';
import { loadRequestSetup, type RequestSetup } from '@/features/upi/loaders';
import { QrCode } from '@/features/upi/QrCode';
import { useTheme } from '@/ui/theme';
import { Text, TextInput } from '@/ui/Text';

type Ready = Extract<RequestSetup, { ok: true }>;

export default function RequestScreen() {
  const { groupId, from, amount } = useLocalSearchParams<{ groupId: string; from?: string; amount?: string }>();
  const theme = useTheme();
  const [setup, setSetup] = useState<RequestSetup>(() => loadRequestSetup(groupId, from));

  // Reload on focus: you may have just added your UPI ID.
  useFocusEffect(
    useCallback(() => {
      setSetup(loadRequestSetup(groupId, from));
    }, [groupId, from]),
  );

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Get paid' }} />
        <Text style={{ color: theme.muted }}>{setup.message}</Text>
      </View>
    );
  }
  return <RequestFlow setup={setup} groupId={groupId} suggestedPaise={Number(amount)} />;
}

function RequestFlow({ setup, groupId, suggestedPaise }: { setup: Ready; groupId: string; suggestedPaise: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { me, payer, myVpa } = setup;

  const [amountText, setAmountText] = useState(() =>
    Number.isSafeInteger(suggestedPaise) && suggestedPaise > 0 ? paiseToInputString(suggestedPaise) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const recorded = useRef(false);

  const parsed = parseRupeesToPaise(amountText);
  const amountPaise = parsed.ok && parsed.paise > 0 ? parsed.paise : null;
  const overLimit = amountPaise !== null && amountPaise > UPI_P2P_LIMIT_PAISE;

  const uri = useMemo(
    () =>
      myVpa && amountPaise !== null && !overLimit
        ? buildUpiPayUri({ payeeVpa: myVpa, payeeName: setup.myName, amountPaise, note: `Settle up ${setup.groupName}` })
        : null,
    [myVpa, amountPaise, overLimit, setup.myName, setup.groupName],
  );

  const markReceived = () => {
    if (amountPaise === null) {
      setError('Enter the amount you received.');
      return;
    }
    const save = () => {
      if (recorded.current) return;
      const result = recordSettlement(appContext, {
        groupId,
        fromMemberId: payer.id,
        toMemberId: me,
        amountPaise,
        method: 'upi',
        note: 'Received via UPI',
        actorMemberId: me,
      });
      if (!result.ok) {
        setError(describeSettlementError(result.error, (id) => (id === payer.id ? payer.name : 'This person')));
        return;
      }
      recorded.current = true;
      router.back();
    };

    const duplicate = isRecentDuplicate(db, groupId, payer.id, me, amountPaise);
    Alert.alert(
      duplicate ? 'Already recorded?' : 'Mark as received?',
      duplicate
        ? `A ${formatPaise(amountPaise)} payment from ${payer.name} to you was recorded in the last 2 days. Record this one as well?`
        : `Only do this once ${formatPaise(amountPaise)} shows up in your UPI app or bank SMS.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: duplicate ? 'Record anyway' : 'Mark received', onPress: save },
      ],
    );
  };

  const shareDetails = () => {
    if (!myVpa) return;
    const what = amountPaise !== null ? `${formatPaise(amountPaise)} ` : '';
    void Share.share({ message: `Please pay me ${what}on UPI for “${setup.groupName}”: ${myVpa}` });
  };

  const hint =
    setup.payerDebtPaise > 0
      ? `${payer.name} owes ${formatPaise(setup.payerDebtPaise)} in total. A part payment is fine.`
      : `${payer.name} doesn’t owe anything right now.`;

  return (
    <>
      <Stack.Screen options={{ title: 'Get paid' }} />
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.title, { color: theme.text }]}>Get paid by {payer.name}</Text>

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
          />
        </View>
        <Text style={{ color: theme.muted }}>{hint}</Text>

        {!myVpa ? (
          <View style={styles.block}>
            <Text style={{ color: theme.text }}>Add your UPI ID in this group to show a payment QR code.</Text>
            <LinkButton
              label="Add your UPI ID"
              onPress={() =>
                router.push({ pathname: '/groups/[groupId]/members/[memberId]/upi', params: { groupId, memberId: me } })
              }
            />
          </View>
        ) : overLimit ? (
          <View style={styles.block}>
            <Text style={{ color: theme.negative }}>
              UPI allows up to {formatPaise(UPI_P2P_LIMIT_PAISE)} per payment. Ask for it in parts.
            </Text>
            <LinkButton
              label={`Ask for ${formatPaise(UPI_P2P_LIMIT_PAISE)} now`}
              onPress={() => setAmountText(paiseToInputString(UPI_P2P_LIMIT_PAISE))}
            />
          </View>
        ) : uri ? (
          <View style={styles.qrBlock}>
            <QrCode value={uri} size={Math.min(width - 64, 300)} label={`UPI QR code to pay ${formatPaise(amountPaise!)} to ${myVpa}`} />
            <Text style={[styles.center, { color: theme.text }]}>
              Ask {payer.name} to scan this with any UPI app. The amount is filled in.
            </Text>
            <Text style={{ color: theme.muted }}>{myVpa}</Text>
            <Text style={{ color: theme.muted }}>Not scanning? Turn your screen brightness up.</Text>
          </View>
        ) : (
          <Text style={{ color: theme.muted }}>Enter an amount to show the QR code.</Text>
        )}

        {error ? <Text style={{ color: theme.negative }}>{error}</Text> : null}

        <PrimaryButton
          label={amountPaise !== null ? `Mark ${formatPaise(amountPaise)} as received` : 'Mark as received'}
          onPress={markReceived}
          disabled={amountPaise === null}
        />
        {myVpa ? <LinkButton label="Share my UPI details instead" onPress={shareDetails} /> : null}
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' },
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  amountRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 18, paddingHorizontal: 16 },
  rupee: { fontSize: 28, marginRight: 6 },
  amountInput: { flex: 1, fontSize: 34, fontWeight: '700', paddingVertical: 10 },
  block: { gap: 6, marginTop: 8 },
  qrBlock: { alignItems: 'center', gap: 8, marginTop: 12 },
});