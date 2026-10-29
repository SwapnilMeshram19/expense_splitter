/**
 * Record a payment between two members, optionally paying by UPI first.
 *
 * UPI from the browser: on a phone, a upi://pay link opens the UPI app chooser (Android Chrome
 * handles it as an intent); on a computer we show the same link as a QR code to scan with any UPI
 * app. The web can't see whether the payment went through, so nothing is recorded until the
 * person taps "Record payment" (same rule as the app: never assume a payment succeeded).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';

import { dataStore } from '@/data';
import { runCommand, useData } from '@/data/hooks';
import { activeMembersOf, balancesOf, findSelfMemberId } from '@/data/selectors';
import { computePairwiseDebts, type Debt } from '@/domain/balances';
import {
  formatMoney,
  minorToInputString,
  parseAmount,
  sanitizeMoneyInput,
} from '@/domain/currency';
import { ledgerOf, SETTLEMENT_METHODS, type SettlementMethod } from '@/domain/model';
import { simplifyDebts } from '@/domain/simplify';
import { buildUpiPayUri, isValidVpa, UPI_P2P_LIMIT_PAISE } from '@/domain/upi';
import { describeSettlementError, METHOD_LABELS } from '@/features/settlements/messages';
import { newId } from '@/lib/newId';

import { useScreenOpen } from '../ui/hooks';
import { Card, ErrorText, Field, Icon, Message, Segmented, Spinner } from '../ui/kit';
import { QrCode } from '../ui/QrCode';

const isPhone = (): boolean => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export function SettleScreen({ groupId }: { groupId: string }) {
  useScreenOpen('Settle up');
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const setup = useData(() => {
    const snapshot = dataStore().group(groupId);
    if (!snapshot) return null;
    const me = findSelfMemberId(snapshot, dataStore().planningUserId());
    const balances = balancesOf(snapshot);
    const ledger = ledgerOf(snapshot);
    return {
      me,
      // The same "who owes whom" the group screen shows, to suggest amounts.
      transfers: snapshot.group.simplifyDebts
        ? simplifyDebts(balances)
        : computePairwiseDebts(ledger.expenses, ledger.settlements).debts,
      currency: snapshot.group.currency,
      groupName: snapshot.group.name,
      members: activeMembersOf(snapshot),
      balances,
    };
  }, [groupId]);

  if (!setup) return <Spinner />;
  if (!setup.me) return <Message title="You’re not a member of this group." />;
  return <SettleForm groupId={groupId} setup={{ ...setup, me: setup.me }} params={params} />;
}

interface Setup {
  me: string;
  currency: string;
  groupName: string;
  members: ReturnType<typeof activeMembersOf>;
  balances: Map<string, number>;
  transfers: Debt[];
}

function SettleForm({
  groupId,
  setup,
  params,
}: {
  groupId: string;
  setup: Setup;
  params: URLSearchParams;
}) {
  const [, navigate] = useLocation();
  const { me, currency, members, balances, transfers } = setup;
  const memberIds = new Set(members.map((m) => m.id));
  const pick = (key: string) => {
    const id = params.get(key)?.toLowerCase();
    return id && memberIds.has(id) ? id : null;
  };
  const suggested = (f: string, t: string) =>
    transfers.find((d) => d.fromMemberId === f && d.toMemberId === t)?.amountPaise ?? 0;
  const asText = (minor: number) => (minor > 0 ? minorToInputString(minor, currency) : '');
  // Opened without a payment in the link: my own biggest debt, else whoever is owed the most.
  const myDebt = transfers
    .filter((d) => d.fromMemberId === me)
    .sort((a, b) => b.amountPaise - a.amountPaise)[0];
  const biggestCreditor =
    [...members]
      .filter((m) => m.id !== me)
      .sort((a, b) => (balances.get(b.id) ?? 0) - (balances.get(a.id) ?? 0))[0]?.id ?? '';
  const [from, setFrom] = useState(pick('from') ?? me);
  const [to, setTo] = useState(pick('to') ?? myDebt?.toMemberId ?? biggestCreditor);
  const linkAmount = Number(params.get('amount'));
  const [amountText, setAmountText] = useState(() =>
    asText(Number.isSafeInteger(linkAmount) && linkAmount > 0 ? linkAmount : suggested(from, to)),
  );
  const [amountTouched, setAmountTouched] = useState(false);
  // Changing who pays whom re-suggests the amount until the person types their own.
  const choose = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    if (!amountTouched) setAmountText(asText(suggested(f, t)));
  };
  const [method, setMethod] = useState<SettlementMethod>(currency === 'INR' ? 'upi' : 'cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) =>
    id === me ? 'You' : (members.find((m) => m.id === id)?.displayName ?? 'Someone');
  const parsed = parseAmount(amountText, currency);
  const payee = members.find((m) => m.id === to);
  const vpa = payee && isValidVpa(payee.upiVpa) ? payee.upiVpa : null;
  const canUpi =
    method === 'upi' && currency === 'INR' && from === me && to !== me && parsed.ok && vpa !== null;
  const overUpiLimit = parsed.ok && parsed.minor > UPI_P2P_LIMIT_PAISE;
  const upiUri =
    canUpi && !overUpiLimit
      ? buildUpiPayUri({
          payeeVpa: vpa,
          payeeName: payee?.displayName ?? '',
          amountPaise: parsed.minor,
          note: setup.groupName,
        })
      : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parsed.ok) return setError('Enter the amount paid.');
    setSaving(true);
    const result = await runCommand('settlement.add', {
      groupId,
      id: newId(),
      fromMemberId: from,
      toMemberId: to,
      amountPaise: parsed.minor,
      method,
      note: note.trim() || null,
    });
    setSaving(false);
    if (!result.ok) return setError(describeSettlementError(result.error, nameOf, currency));
    navigate(`/groups/${groupId}`, { replace: true });
  };

  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={(e) => void submit(e)} noValidate>
      <div className="row">
        <Link href={`/groups/${groupId}`} className="icon-btn" aria-label="Back to the group">
          <Icon name="back" />
        </Link>
        <h1 className="grow">Settle up</h1>
      </div>

      <Card>
        <div className="row wrap">
          <Field label="Who paid">
            <select className="input" value={from} onChange={(e) => choose(e.target.value, to)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {nameOf(m.id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="To">
            <select className="input" value={to} onChange={(e) => choose(from, e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id} disabled={m.id === from}>
                  {nameOf(m.id)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={`Amount (${currency})`}>
          <input
            className="input amount-input"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => {
              setAmountTouched(true);
              setAmountText(sanitizeMoneyInput(e.target.value, amountText, currency));
            }}
            placeholder="0"
          />
        </Field>
        <Segmented
          label="How it was paid"
          value={method}
          options={SETTLEMENT_METHODS.filter((m) => m !== 'upi' || currency === 'INR').map((m) => ({
            value: m,
            label: METHOD_LABELS[m],
          }))}
          onChange={setMethod}
        />
        <Field label="Note (optional)">
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={100}
          />
        </Field>
      </Card>

      {method === 'upi' && from === me && to !== me ? (
        <Card>
          <h2>Pay with UPI</h2>
          {!vpa ? (
            <p className="small muted">
              {nameOf(to)} hasn’t added a UPI ID. Pay them another way, then record it here.
            </p>
          ) : overUpiLimit ? (
            <p className="small muted">
              UPI payments to a person are limited to {formatMoney(UPI_P2P_LIMIT_PAISE, 'INR')}. Pay
              in parts, recording each one.
            </p>
          ) : upiUri ? (
            isPhone() ? (
              <>
                <a className="btn block" href={upiUri}>
                  Pay {formatMoney(parsed.ok ? parsed.minor : 0, currency)} in a UPI app
                </a>
                <p className="small muted">Then come back and record the payment.</p>
              </>
            ) : (
              <>
                <QrCode text={upiUri} label={`UPI QR code to pay ${nameOf(to)}`} />
                <p className="small muted" style={{ textAlign: 'center' }}>
                  Scan with any UPI app on your phone. Check the name and amount before you pay.
                </p>
              </>
            )
          ) : (
            <p className="small muted">Enter the amount to get a UPI link.</p>
          )}
        </Card>
      ) : null}

      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn block" disabled={saving || from === to}>
        {saving ? 'Saving…' : 'Record payment'}
      </button>
    </form>
  );
}
