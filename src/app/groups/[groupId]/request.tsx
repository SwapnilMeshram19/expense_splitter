import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, useWindowDimensions, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { recordSettlement } from '@/db/repositories/settlements';
import {
  formatMoney,
  minorDigits,
  minorToInputString,
  parseAmount,
  sanitizeMoneyInput,
} from '@/domain/currency';
import {
  buildEpcPayload,
  buildPayNowPayload,
  buildPixPayload,
  buildPromptPayPayload,
  methodShareLine,
  methodTitle,
  payLinkFor,
  worksForCurrency,
  type PayMethod,
} from '@/domain/payMethods';
import { buildUpiPayUri, UPI_P2P_LIMIT_PAISE } from '@/domain/upi';
import { useInrConversion } from '@/features/payments/inrConversion';
import { describeSettlementError } from '@/features/settlements/messages';
import { reminderMessage } from '@/features/share/messages';
import { ShareButtons } from '@/features/share/ShareButtons';
import { LinkButton } from '@/features/upi/buttons';
import { isRecentDuplicate } from '@/features/upi/duplicates';
import { loadRequestSetup, type RequestSetup } from '@/features/upi/loaders';
import { QrCode } from '@/features/upi/QrCode';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { AmountInput } from '@/ui/Field';
import { Segmented } from '@/ui/Segmented';
import { useTheme } from '@/ui/theme';

type Ready = Extract<RequestSetup, { ok: true }>;

interface QrOption {
  value: string;
  label: string;
  payload: string;
  /** "any UPI app" / "their banking app" */
  scanWith: string;
}

export default function RequestScreen() {
  const { groupId, from, amount } = useLocalSearchParams<{ groupId: string; from?: string; amount?: string }>();
  const theme = useTheme();
  const [setup, setSetup] = useState<RequestSetup>(() => loadRequestSetup(groupId, from));

  // Reload on focus: you may have just added your payment details.
  useFocusEffect(
    useCallback(() => {
      setSetup(loadRequestSetup(groupId, from));
    }, [groupId, from]),
  );

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Get paid' }} />
        <AppText color={theme.muted}>{setup.message}</AppText>
      </View>
    );
  }
  return <RequestFlow setup={setup} groupId={groupId} suggestedMinor={Number(amount)} />;
}

/** QR codes this group's currency can use, from my details. Static payloads, amount filled in. */
function qrOptions(
  setup: Ready,
  amountMinor: number | null,
  upiPaise: number | null,
  methods: readonly PayMethod[],
): QrOption[] {
  if (amountMinor === null) return [];
  const out: QrOption[] = [];
  const note = `Settle up ${setup.groupName}`;
  if (setup.myVpa && upiPaise !== null && upiPaise <= UPI_P2P_LIMIT_PAISE) {
    out.push({
      value: 'upi',
      label: 'UPI',
      payload: buildUpiPayUri({ payeeVpa: setup.myVpa, payeeName: setup.myName, amountPaise: upiPaise, note }),
      scanWith: 'any UPI app',
    });
  }
  for (const m of methods) {
    try {
      if (m.kind === 'iban' && setup.currency === 'EUR') {
        out.push({
          value: `iban-${m.iban}`,
          label: 'SEPA',
          payload: buildEpcPayload({ name: m.name, iban: m.iban, bic: m.bic, amountCents: amountMinor, message: note }),
          scanWith: 'their banking app',
        });
      } else if (m.kind === 'pix') {
        out.push({
          value: `pix-${m.key}`,
          label: 'Pix',
          payload: buildPixPayload({ key: m.key, name: m.name, city: m.city, amountCentavos: amountMinor }),
          scanWith: 'their bank app',
        });
      } else if (m.kind === 'paynow') {
        out.push({
          value: `paynow-${m.proxy}`,
          label: 'PayNow',
          payload: buildPayNowPayload({ proxy: m.proxy, name: m.name || setup.myName, amountCents: amountMinor }),
          scanWith: 'their banking app',
        });
      } else if (m.kind === 'promptpay') {
        out.push({
          value: `promptpay-${m.id}`,
          label: 'PromptPay',
          payload: buildPromptPayPayload({ id: m.id, amountSatang: amountMinor }),
          scanWith: 'their banking app',
        });
      }
    } catch {
      // An amount a format can't carry (e.g. over EPC's limit): just leave that QR out.
    }
  }
  return out;
}

function RequestFlow({ setup, groupId, suggestedMinor }: { setup: Ready; groupId: string; suggestedMinor: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { me, payer, myVpa, currency } = setup;
  const money = (minor: number) => formatMoney(minor, currency);

  const [amountText, setAmountText] = useState(() =>
    Number.isSafeInteger(suggestedMinor) && suggestedMinor > 0 ? minorToInputString(suggestedMinor, currency) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const recorded = useRef(false);

  const parsed = parseAmount(amountText, currency);
  const amountMinor = parsed.ok ? parsed.minor : null;
  const conversion = useInrConversion(currency, amountMinor, myVpa !== null);
  const upiPaise = currency === 'INR' ? amountMinor : (conversion?.inrPaise ?? null);
  const methods = setup.myMethods.filter((m) => worksForCurrency(m, currency));

  const options = useMemo(
    () => qrOptions(setup, amountMinor, upiPaise, methods),
    // methods is derived from setup + currency; listing them keeps the memo honest without churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setup, amountMinor, upiPaise],
  );
  const shown = options.find((o) => o.value === picked) ?? options[0] ?? null;
  const hasDetails = myVpa !== null || methods.length > 0;

  const markReceived = () => {
    if (amountMinor === null) {
      setError('Enter the amount you received.');
      return;
    }
    const save = () => {
      if (recorded.current) return;
      const result = recordSettlement(appContext, {
        groupId,
        fromMemberId: payer.id,
        toMemberId: me,
        amountPaise: amountMinor,
        method: shown?.value === 'upi' ? 'upi' : 'other',
        note: shown ? `Received via ${shown.label}` : 'Received',
        actorMemberId: me,
      });
      if (!result.ok) {
        setError(describeSettlementError(result.error, (id) => (id === payer.id ? payer.name : 'This person'), currency));
        return;
      }
      recorded.current = true;
      router.back();
    };

    const duplicate = isRecentDuplicate(db, groupId, payer.id, me, amountMinor);
    Alert.alert(
      duplicate ? 'Already recorded?' : 'Mark as received?',
      duplicate
        ? `${money(amountMinor)} from ${payer.name} was recorded in the last 2 days. Record again?`
        : `Only once ${money(amountMinor)} shows in your account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: duplicate ? 'Record anyway' : 'Mark received', onPress: save },
      ],
    );
  };

  const reminder = () =>
    reminderMessage({
      groupName: setup.groupName,
      currency,
      debtorName: payer.name,
      amountPaise: amountMinor,
      upiId: myVpa,
      inrPaise: currency === 'INR' ? null : upiPaise,
      otherWays: methods.map((m) =>
        m.kind === 'link' && amountMinor !== null
          ? `${methodTitle(m)}: ${payLinkFor(m.url, amountMinor, currency, minorDigits(currency)).url}`
          : methodShareLine(m),
      ),
    });

  const debt = setup.payerDebtPaise;
  const hint =
    debt > 0 ? `${payer.name} owes ${money(debt)}. Part payment is fine.` : `${payer.name} doesn’t owe anything right now.`;

  return (
    <>
      <Stack.Screen options={{ title: 'Get paid' }} />
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <View style={styles.person}>
            <Avatar seed={payer.id} name={payer.name} size={44} />
            <View style={styles.grow}>
              <AppText variant="label" color={theme.muted}>
                Get paid by
              </AppText>
              <AppText variant="heading" numberOfLines={1}>
                {payer.name}
              </AppText>
            </View>
          </View>
          <AmountInput
            value={amountText}
            currency={currency}
            onChangeText={(text) => {
              setAmountText(sanitizeMoneyInput(text, amountText, currency));
              setError(null);
            }}
          />
          <AppText variant="caption" color={theme.muted}>
            {hint}
          </AppText>
        </Card>

        {!hasDetails ? (
          <Banner tone="info" icon="wallet" title="Add how you get paid" body="Then you can show a QR code here.">
            <Button label="Add payment details" icon="add" variant="secondary" onPress={() => router.push('/payment-details')} />
          </Banner>
        ) : shown ? (
          <Card style={[styles.card, styles.qrCard]}>
            {options.length > 1 ? (
              <View style={styles.stretch}>
                <Segmented
                  options={options.map((o) => ({ value: o.value, label: o.label }))}
                  value={shown.value}
                  onChange={setPicked}
                  accessibilityLabel="QR code type"
                />
              </View>
            ) : null}
            <QrCode value={shown.payload} size={Math.min(width - 104, 280)} label={`${shown.label} QR code`} />
            <AppText style={styles.centerText}>
              {payer.name} scans with {shown.scanWith}.
            </AppText>
            {shown.value === 'upi' && currency !== 'INR' && upiPaise !== null && conversion ? (
              <AppText variant="caption" color={theme.muted} style={styles.centerText}>
                {formatMoney(upiPaise, 'INR')} · {conversion.label}
              </AppText>
            ) : null}
            <AppText variant="caption" color={theme.muted} style={styles.centerText}>
              Not scanning? Raise screen brightness.
            </AppText>
          </Card>
        ) : amountMinor === null ? (
          <AppText color={theme.muted} style={styles.centerText}>
            Enter an amount to show a QR code.
          </AppText>
        ) : null}

        {hasDetails ? (
          <Card style={styles.card}>
            <AppText variant="heading">Not together?</AppText>
            <AppText variant="caption" color={theme.muted}>
              Send a reminder with your payment details.
            </AppText>
            <ShareButtons label="Remind" accessibilityLabel={`Remind ${payer.name} on WhatsApp`} getText={reminder} />
          </Card>
        ) : null}

        {error ? (
          <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
            {error}
          </AppText>
        ) : null}

        <Button
          label={amountMinor !== null ? `Mark ${money(amountMinor)} received` : 'Mark as received'}
          icon="check"
          size="lg"
          onPress={markReceived}
          disabled={amountMinor === null}
        />
        <LinkButton
          label="Received cash? Record it"
          onPress={() =>
            router.replace({
              pathname: '/groups/[groupId]/settle',
              params: { groupId, from: payer.id, to: me, ...(amountMinor ? { amount: String(amountMinor) } : {}) },
            })
          }
        />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 14 },
  card: { gap: 10 },
  qrCard: { alignItems: 'center' },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  centerText: { textAlign: 'center' },
  stretch: { alignSelf: 'stretch' },
});
