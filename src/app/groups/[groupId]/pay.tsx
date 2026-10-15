import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { MAX_NOTE_LENGTH, recordSettlement } from '@/db/repositories/settlements';
import type { SettlementMethod } from '@/db/schema';
import {
  formatMoney,
  minorDigits,
  minorToInputString,
  parseAmount,
  sanitizeMoneyInput,
} from '@/domain/currency';
import {
  buildPixPayload,
  formatIban,
  methodTitle,
  minorToDecimal,
  payLinkFor,
  worksForCurrency,
  type PayMethod,
} from '@/domain/payMethods';
import { buildUpiPayUri, UPI_P2P_LIMIT_PAISE, UTR_PATTERN } from '@/domain/upi';
import { useInrConversion } from '@/features/payments/inrConversion';
import { iconForKind } from '@/features/payments/messages';
import { describeSettlementError } from '@/features/settlements/messages';
import { copyText } from '@/features/share/copyText';
import { LinkButton } from '@/features/upi/buttons';
import { isRecentDuplicate } from '@/features/upi/duplicates';
import { hasUpiApp, openUpiApp } from '@/features/upi/launch';
import { loadPaySetup, type PaySetup } from '@/features/upi/loaders';
import {
  clearPendingUpiPayment,
  getPendingUpiPayment,
  savePendingUpiPayment,
  type PendingUpiPayment,
} from '@/features/upi/pendingUpiPayment';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { Banner } from '@/ui/Banner';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { CopyField } from '@/ui/CopyField';
import { AmountInput, FieldLabel, Input } from '@/ui/Field';
import { Icon, type IconName } from '@/ui/Icon';
import { useTheme } from '@/ui/theme';

type Ready = Extract<PaySetup, { ok: true }>;
type Phase = 'form' | 'waiting' | 'confirm';

/** What the payer chose, remembered until they confirm. */
interface Attempt {
  via: string;
  upi: boolean;
  inrPaise?: number;
  rate?: string;
}

// Module-level (not in a component), so reading the clock here is fine for the compiler's purity rule.
function newPending(fields: Omit<PendingUpiPayment, 'startedAt'>): PendingUpiPayment {
  return { ...fields, startedAt: Date.now() };
}

export default function PayScreen() {
  const { groupId, to, amount } = useLocalSearchParams<{ groupId: string; to?: string; amount?: string }>();
  const theme = useTheme();
  const [setup, setSetup] = useState<PaySetup>(() => loadPaySetup(groupId, to));

  // Reload on focus: the payee's details may have just been added.
  useFocusEffect(
    useCallback(() => {
      setSetup(loadPaySetup(groupId, to));
    }, [groupId, to]),
  );

  if (!setup.ok) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Pay' }} />
        <AppText color={theme.muted}>{setup.message}</AppText>
      </View>
    );
  }
  return <PayFlow setup={setup} groupId={groupId} suggestedMinor={Number(amount)} />;
}

function PayFlow({ setup, groupId, suggestedMinor }: { setup: Ready; groupId: string; suggestedMinor: number }) {
  const theme = useTheme();
  const { me, payee, currency } = setup;
  const money = (minor: number) => formatMoney(minor, currency);

  // A payment started earlier to the same person (app may have been killed meanwhile) → ask first.
  const [initial] = useState(() => {
    const p = getPendingUpiPayment(appContext);
    const resumed = p && p.groupId === groupId && p.fromMemberId === me && p.toMemberId === payee.id ? p : null;
    const minor = resumed ? resumed.amountPaise : suggestedMinor;
    return {
      phase: (resumed ? 'confirm' : 'form') as Phase,
      amountText: Number.isSafeInteger(minor) && minor > 0 ? minorToInputString(minor, currency) : '',
      attempt: resumed
        ? ({ via: resumed.via ?? 'UPI', upi: (resumed.via ?? 'UPI') === 'UPI', inrPaise: resumed.inrPaise, rate: resumed.rate } as Attempt)
        : null,
    };
  });
  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [attempt, setAttempt] = useState<Attempt | null>(initial.attempt);
  const [amountText, setAmountText] = useState(initial.amountText);
  const [utr, setUtr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [upiAppFound, setUpiAppFound] = useState<boolean | null>(null);

  const awaitingReturn = useRef(false);
  const leftApp = useRef(false);
  const recorded = useRef(false);

  const parsed = parseAmount(amountText, currency);
  const amountMinor = parsed.ok ? parsed.minor : null;
  const conversion = useInrConversion(currency, amountMinor, payee.vpa !== null);
  const upiPaise = currency === 'INR' ? amountMinor : (conversion?.inrPaise ?? null);
  const overUpiLimit = upiPaise !== null && upiPaise > UPI_P2P_LIMIT_PAISE;
  const methods = payee.methods.filter((m) => worksForCurrency(m, currency));

  useEffect(() => {
    if (!payee.vpa) return;
    let alive = true;
    void hasUpiApp().then((found) => {
      if (alive) setUpiAppFound(found);
    });
    return () => {
      alive = false;
    };
  }, [payee.vpa]);

  // Subscribed for the whole screen: the app can go to background before openURL resolves.
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

  const begin = (next: Attempt, minor: number) => {
    setAttempt(next);
    savePendingUpiPayment(
      appContext,
      newPending({ groupId, fromMemberId: me, toMemberId: payee.id, amountPaise: minor, ...next }),
    );
  };

  const needAmount = (): number | null => {
    if (amountMinor === null) setError('Enter a valid amount.');
    return amountMinor;
  };

  /** Leave for another app; when the user comes back, ask whether it went through. */
  const leaveFor = async (open: () => Promise<boolean>, next: Attempt, minor: number) => {
    begin(next, minor);
    awaitingReturn.current = true;
    leftApp.current = false;
    setLaunching(true);
    const opened = await open();
    setLaunching(false);
    if (opened) {
      setPhase((p) => (p === 'confirm' ? p : 'waiting'));
      return;
    }
    awaitingReturn.current = false;
    clearPendingUpiPayment(appContext);
    setError(next.upi ? 'No UPI app opened. Copy the UPI ID and pay from your app.' : 'Couldn’t open the link.');
  };

  const payWithUpi = () => {
    const minor = needAmount();
    if (minor === null || !payee.vpa || upiPaise === null || overUpiLimit) return;
    let uri: string;
    try {
      uri = buildUpiPayUri({ payeeVpa: payee.vpa, payeeName: payee.name, amountPaise: upiPaise, note: `Settle up ${setup.groupName}` });
    } catch {
      setError(`The UPI ID saved for ${payee.name} isn’t valid.`);
      return;
    }
    const next: Attempt =
      currency === 'INR' ? { via: 'UPI', upi: true } : { via: 'UPI', upi: true, inrPaise: upiPaise, rate: conversion?.rate };
    void leaveFor(async () => (await openUpiApp(uri)) === 'opened', next, minor);
  };

  const openLink = (m: Extract<PayMethod, { kind: 'link' }>) => {
    const minor = needAmount();
    if (minor === null) return;
    const link = payLinkFor(m.url, minor, currency, minorDigits(currency));
    void leaveFor(
      async () => {
        // Where the link can't carry the amount, it's on the clipboard to paste.
        if (!link.amountIncluded) await copyText(minorToInputString(minor, currency), 'Amount copied');
        try {
          await Linking.openURL(link.url);
          return true;
        } catch {
          return false;
        }
      },
      { via: methodTitle(m), upi: false },
      minor,
    );
  };

  const copyPix = (m: Extract<PayMethod, { kind: 'pix' }>) => {
    const minor = needAmount();
    if (minor === null) return;
    void copyText(buildPixPayload({ key: m.key, name: m.name, city: m.city, amountCentavos: minor }), 'Pix code copied');
    begin({ via: 'Pix', upi: false }, minor);
    awaitingReturn.current = true;
    leftApp.current = false;
    setPhase('waiting');
  };

  /** Bank transfers etc.: the payer copies details and comes back to confirm. */
  const sentManually = (via: string) => {
    const minor = needAmount();
    if (minor === null) return;
    begin({ via, upi: false }, minor);
    awaitingReturn.current = false;
    setError(null);
    setPhase('confirm');
  };

  const recordCashInstead = () =>
    router.replace({
      pathname: '/groups/[groupId]/settle',
      params: { groupId, from: me, to: payee.id, ...(amountMinor ? { amount: String(amountMinor) } : {}) },
    });

  const recordPayment = () => {
    const minor = needAmount();
    if (minor === null || !attempt) return;
    const ref = utr.replace(/\s+/g, '');
    if (attempt.upi && ref !== '' && !UTR_PATTERN.test(ref)) {
      setError('UPI reference is 12 digits. Or leave it blank.');
      return;
    }
    const parts = [
      attempt.inrPaise ? `${formatMoney(attempt.inrPaise, 'INR')} via UPI` : `Paid via ${attempt.via}`,
      attempt.inrPaise && attempt.rate ? `1 ${currency} = ₹${attempt.rate}` : null,
      ref ? `ref ${ref}` : null,
    ];
    const note = parts.filter(Boolean).join(' · ').slice(0, MAX_NOTE_LENGTH);
    const method: SettlementMethod = attempt.upi ? 'upi' : 'other';

    const save = () => {
      if (recorded.current) return;
      const result = recordSettlement(appContext, {
        groupId,
        fromMemberId: me,
        toMemberId: payee.id,
        amountPaise: minor,
        method,
        note,
        actorMemberId: me,
      });
      if (!result.ok) {
        setError(describeSettlementError(result.error, (id) => (id === payee.id ? payee.name : 'This person'), currency));
        return;
      }
      recorded.current = true;
      clearPendingUpiPayment(appContext);
      router.back();
    };

    // The payee may already have recorded it on their phone.
    if (isRecentDuplicate(db, groupId, me, payee.id, minor)) {
      Alert.alert('Already recorded?', `${money(minor)} to ${payee.name} was recorded in the last 2 days. Record again?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Record anyway', onPress: save },
      ]);
      return;
    }
    save();
  };

  const markFailed = () => {
    clearPendingUpiPayment(appContext);
    awaitingReturn.current = false;
    setError(null);
    setUtr('');
    setAttempt(null);
    setPhase('form');
  };

  const errorText = error ? (
    <AppText variant="label" color={theme.negative} accessibilityLiveRegion="polite">
      {error}
    </AppText>
  ) : null;

  // ── Waiting for the other app ──
  if (phase === 'waiting') {
    return (
      <View style={styles.waiting}>
        <Stack.Screen options={{ title: `Pay ${payee.name}` }} />
        <ActivityIndicator color={theme.primary} size="large" />
        <AppText variant="heading" style={styles.centerText}>
          {attempt?.via === 'Pix' ? 'Paste the Pix code in your bank app' : `Finish in ${attempt?.via ?? 'the other app'}`}
        </AppText>
        <AppText color={theme.muted} style={styles.centerText}>
          Come back here when you’re done.
        </AppText>
        <Button label="I’m back" size="lg" onPress={() => setPhase('confirm')} style={styles.stretch} />
      </View>
    );
  }

  // ── Did it go through? ──
  if (phase === 'confirm') {
    return (
      <>
        <Stack.Screen options={{ title: 'Confirm payment' }} />
        <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Card style={styles.card}>
            <AppText variant="heading">Did your payment to {payee.name} go through?</AppText>
            <AppText variant="label" color={theme.muted}>
              {attempt?.upi ? 'Check your UPI app or bank SMS.' : `Check ${attempt?.via ?? 'your app'}.`}
            </AppText>
            {attempt?.inrPaise ? (
              <AppText variant="label" color={theme.muted}>
                You sent {formatMoney(attempt.inrPaise, 'INR')} by UPI.
              </AppText>
            ) : null}
            <FieldLabel>Amount paid</FieldLabel>
            <AmountInput
              value={amountText}
              currency={currency}
              onChangeText={(text) => {
                setAmountText(sanitizeMoneyInput(text, amountText, currency));
                setError(null);
              }}
            />
            {attempt?.upi ? (
              <>
                <FieldLabel>UPI reference (optional)</FieldLabel>
                <Input
                  value={utr}
                  onChangeText={(v) => {
                    setUtr(v);
                    setError(null);
                  }}
                  placeholder="12 digits"
                  keyboardType="number-pad"
                  maxLength={16}
                  accessibilityLabel="UPI reference"
                />
              </>
            ) : null}
          </Card>
          {errorText}
          <Button
            label={amountMinor ? `Yes, record ${money(amountMinor)}` : 'Yes, record it'}
            icon="check"
            size="lg"
            onPress={recordPayment}
          />
          <View style={styles.row}>
            <Button label="It failed" icon="close" variant="danger" onPress={markFailed} style={styles.grow} />
            <Button label="Not sure yet" variant="secondary" onPress={() => router.back()} style={styles.grow} />
          </View>
        </KeyboardAwareScrollView>
        <KeyboardToolbar />
      </>
    );
  }

  // ── Choose how to pay ──
  const debt = setup.myDebtPaise;
  const hint =
    debt === 0
      ? 'You don’t owe anything right now.'
      : amountMinor !== null && amountMinor > debt
        ? `More than you owe (${money(debt)}).`
        : `You owe ${money(debt)}. Part payment is fine.`;
  const nothing = !payee.vpa && methods.length === 0;
  // The first way to pay gets the filled button; the rest are outlined, so one action leads.
  const variantFor = (index: number) => ((payee.vpa ? index === -1 : index === 0) ? 'primary' : 'secondary');

  return (
    <>
      <Stack.Screen options={{ title: 'Pay' }} />
      <KeyboardAwareScrollView bottomOffset={62} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <View style={styles.person}>
            <Avatar seed={payee.id} name={payee.name} size={44} />
            <View style={styles.grow}>
              <AppText variant="label" color={theme.muted}>
                Pay
              </AppText>
              <AppText variant="heading" numberOfLines={1}>
                {payee.name}
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

        {errorText}

        {payee.isPlaceholder && !nothing ? (
          <AppText variant="caption" color={theme.muted} style={styles.centerText}>
            {payee.name} isn’t on the app. Check these details with them.
          </AppText>
        ) : null}

        {/* UPI: rupees, also for groups in other currencies (converted at today's rate). */}
        {payee.vpa ? (
          <MethodCard icon="upiPay" title="UPI" detail={payee.vpa}>
            {currency !== 'INR' && amountMinor !== null ? (
              <AppText variant="caption" color={theme.muted}>
                {conversion ? `${conversion.label} · today’s rate` : 'Getting today’s rate…'}
              </AppText>
            ) : null}
            {overUpiLimit ? (
              <AppText variant="caption" color={theme.negative}>
                UPI limit is {formatMoney(UPI_P2P_LIMIT_PAISE, 'INR')} per payment. Pay in parts.
              </AppText>
            ) : null}
            {upiAppFound === false ? (
              <AppText variant="caption" color={theme.warning}>
                No UPI app found. Try anyway, or copy the UPI ID.
              </AppText>
            ) : null}
            <View style={styles.row}>
              <Button
                label={upiPaise ? `Pay ${formatMoney(upiPaise, 'INR')}` : 'Pay with UPI'}
                icon="upiPay"
                variant={variantFor(-1)}
                busy={launching}
                disabled={upiPaise === null || overUpiLimit}
                onPress={payWithUpi}
                style={styles.grow}
              />
              <Button
                label="Copy ID"
                icon="copy"
                variant="secondary"
                onPress={() => void copyText(payee.vpa!, 'UPI ID copied')}
              />
            </View>
          </MethodCard>
        ) : null}

        {methods.map((m, i) => (
          <MethodCard key={i} icon={iconForKind(m.kind)} title={methodTitle(m)} detail={null}>
            <MethodBody method={m} amountMinor={amountMinor} currency={currency} payeeName={payee.name} />
            {m.kind === 'link' ? (
              <>
                <Button
                  label={`Open ${methodTitle(m)}`}
                  icon="openExternal"
                  variant={variantFor(i)}
                  onPress={() => openLink(m)}
                />
                <AppText variant="caption" color={theme.muted} style={styles.centerText}>
                  {amountMinor !== null && payLinkFor(m.url, amountMinor, currency, minorDigits(currency)).amountIncluded
                    ? 'Amount filled in.'
                    : 'Amount is copied: paste it there.'}
                </AppText>
              </>
            ) : m.kind === 'pix' ? (
              <Button label="Copy Pix code" icon="copy" variant={variantFor(i)} onPress={() => copyPix(m)} />
            ) : (
              <Button label="I’ve sent it" icon="check" variant={variantFor(i)} onPress={() => sentManually(methodTitle(m))} />
            )}
          </MethodCard>
        ))}

        {nothing ? (
          <Banner tone="info" icon="wallet" title={`${payee.name} hasn’t added payment details`}>
            {payee.canEditVpa ? (
              <Button
                label="Add their details"
                icon="add"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/groups/[groupId]/members/[memberId]/payment',
                    params: { groupId, memberId: payee.id },
                  })
                }
              />
            ) : null}
          </Banner>
        ) : null}

        <LinkButton label="Paid in cash or another way? Record it" onPress={recordCashInstead} />
      </KeyboardAwareScrollView>
      <KeyboardToolbar />
    </>
  );
}

function MethodCard({
  icon,
  title,
  detail,
  children,
}: {
  icon: IconName;
  title: string;
  detail: string | null;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.card}>
      <View style={styles.person}>
        <View style={[styles.methodIcon, { backgroundColor: theme.primarySoft }]}>
          <Icon name={icon} color={theme.onPrimarySoft} size={20} />
        </View>
        <View style={styles.grow}>
          <AppText variant="heading">{title}</AppText>
          {detail ? (
            <AppText variant="label" color={theme.muted} numberOfLines={1} selectable>
              {detail}
            </AppText>
          ) : null}
        </View>
      </View>
      {children}
    </Card>
  );
}

/** The details a payer needs to copy for each kind of method. */
function MethodBody({
  method: m,
  amountMinor,
  currency,
  payeeName,
}: {
  method: PayMethod;
  amountMinor: number | null;
  currency: string;
  payeeName: string;
}) {
  const amount =
    amountMinor !== null ? (
      <CopyField
        label="Amount"
        value={formatMoney(amountMinor, currency)}
        copyValue={minorToDecimal(amountMinor, minorDigits(currency))}
      />
    ) : null;
  switch (m.kind) {
    case 'link':
      return <CopyField label="Link" value={m.url.replace(/^https:\/\//, '')} copyValue={m.url} />;
    case 'iban':
      return (
        <>
          <CopyField label="Name" value={m.name} />
          <CopyField label="IBAN" value={formatIban(m.iban)} copyValue={m.iban} />
          {m.bic ? <CopyField label="BIC" value={m.bic} /> : null}
          {amount}
        </>
      );
    case 'bank':
      return (
        <>
          <CopyField label="Bank details" value={m.text} />
          {amount}
        </>
      );
    case 'pix':
      return <CopyField label="Pix key" value={m.key} />;
    case 'paynow':
      return (
        <>
          <CopyField label={m.proxy.startsWith('+') ? 'PayNow mobile' : 'PayNow UEN'} value={m.proxy} />
          {m.name ? <CopyField label="Name" value={m.name} /> : null}
          {amount}
        </>
      );
    case 'promptpay':
      return (
        <>
          <CopyField label={`PromptPay (${payeeName})`} value={m.id} />
          {amount}
        </>
      );
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  container: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 14 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  card: { gap: 10 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  methodIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: 10 },
  centerText: { textAlign: 'center' },
  stretch: { alignSelf: 'stretch' },
});
