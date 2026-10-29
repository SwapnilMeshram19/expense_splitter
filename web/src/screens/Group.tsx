import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link } from 'wouter';

import { dataStore } from '@/data';
import { runCommand, useData } from '@/data/hooks';
import { formatMoney } from '@/domain/currency';
import { MAX_NAME_LENGTH } from '@/domain/names';
import { describeMyBalance, describeMyExpenseShare } from '@/features/balances/describe';
import { loadGroupView, type HistoryRow } from '@/features/groups/loadGroupView';
import { describeMemberError } from '@/features/groups/messages';
import { createInvite } from '@/features/invites/inviteApi';
import {
  buildShareMessage,
  describeInviteStatus,
  formatInviteCode,
  inviteUrl,
} from '@/features/invites/messages';
import { METHOD_LABELS } from '@/features/settlements/messages';
import { todayIsoDate } from '@/lib/dates';
import { newId } from '@/lib/newId';

import { useAuth } from '../platform/auth';
import { useScreenOpen } from '../ui/hooks';
import {
  Avatar,
  AvatarStack,
  Card,
  CardHead,
  CategoryTile,
  ErrorText,
  Icon,
  Message,
  Spinner,
} from '../ui/kit';

type View = NonNullable<ReturnType<typeof loadGroupView>>;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function PendingChip({ id }: { id: string }) {
  const status = useData(() => dataStore().pendingStatus(id), [id]);
  if (!status) return null;
  return (
    <span className="chip">
      {status === 'failed' ? 'Not saved' : status === 'queued' ? 'Not sent yet' : 'Saving…'}
    </span>
  );
}

function HistoryList({ rows, view, groupId }: { rows: HistoryRow[]; view: View; groupId: string }) {
  const nameOf = (id: string) => (id === view.me ? 'You' : (view.names.get(id) ?? 'Someone'));
  const currency = view.group.currency;
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'date') {
          return (
            <div key={row.key} className="date-header">
              {row.label}
            </div>
          );
        }
        if (row.kind === 'expense') {
          const { expense } = row;
          const paidBy =
            row.payers.length === 1
              ? nameOf(row.payers[0]!.memberId)
              : `${row.payers.length} people`;
          const mine = describeMyExpenseShare(row.myNet, row.involved, currency);
          const content = (
            <>
              <CategoryTile category={expense.category} />
              <div className="grow">
                <div className="row-title ellipsis">
                  {expense.description} <PendingChip id={expense.id} />
                </div>
                <div className="row-sub ellipsis">
                  {paidBy} paid {formatMoney(expense.amountPaise, currency)}
                </div>
              </div>
              <div className={`row-end ${mine.tone}`}>
                <div>{mine.lead}</div>
                {mine.amount ? <div className="amount">{mine.amount}</div> : null}
              </div>
            </>
          );
          return view.canEdit ? (
            <Link
              key={row.key}
              href={`/groups/${groupId}/expenses/${expense.id}`}
              className="list-row"
            >
              {content}
            </Link>
          ) : (
            <div key={row.key} className="list-row static">
              {content}
            </div>
          );
        }
        const s = row.settlement;
        return (
          <div key={row.key} className="list-row static">
            <span className="tile sw-2" aria-hidden="true">
              <Icon name="check" />
            </span>
            <div className="grow">
              <div className="row-title ellipsis">
                {nameOf(s.fromMemberId)} paid{' '}
                {s.toMemberId === view.me ? 'you' : nameOf(s.toMemberId)} <PendingChip id={s.id} />
              </div>
              <div className="row-sub">Payment by {METHOD_LABELS[s.method]}</div>
            </div>
            <span className="row-end amount">{formatMoney(s.amountPaise, currency)}</span>
          </div>
        );
      })}
    </>
  );
}

function AddPerson({ groupId, currency }: { groupId: string; currency: string }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const result = await runCommand('member.add', { groupId, id: newId(), displayName: name });
    setSaving(false);
    if (!result.ok) return setError(describeMemberError(result.error, currency));
    setName('');
  };
  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      <div className="row">
        <input
          className="input grow"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a person"
          maxLength={MAX_NAME_LENGTH}
          aria-label="Name of the person to add"
        />
        <button type="submit" className="btn small" disabled={saving || name.trim() === ''}>
          Add
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function Invite({ groupId, groupName }: { groupId: string; groupName: string }) {
  const auth = useAuth();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'ready'; code: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  if (auth.status !== 'signedIn') {
    return (
      <p className="small muted">
        To invite people, <Link href="/account">save your account</Link> first, so the group never
        depends on a browser that could be cleared.
      </p>
    );
  }

  const create = async () => {
    setState({ kind: 'busy' });
    const result = await createInvite(groupId);
    setState(
      result.ok
        ? { kind: 'ready', code: result.value.code }
        : { kind: 'error', message: describeInviteStatus(result.error.status) },
    );
  };

  if (state.kind === 'ready') {
    const message = buildShareMessage(groupName, state.code);
    const share = async () => {
      if (navigator.share) {
        try {
          await navigator.share({ text: message });
          return;
        } catch {
          // dismissed: fall back to copying
        }
      }
      await navigator.clipboard?.writeText(message).catch(() => undefined);
    };
    return (
      <div className="stack">
        <p className="code">{formatInviteCode(state.code)}</p>
        <input
          className="input small"
          readOnly
          value={inviteUrl(state.code)}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Invite link"
        />
        <div className="row wrap">
          <button type="button" className="btn small" onClick={() => void share()}>
            Share invite
          </button>
          <a
            className="btn small secondary"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
        </div>
        <p className="small muted">Expires in 7 days.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="btn small secondary"
        disabled={state.kind === 'busy'}
        onClick={() => void create()}
      >
        {state.kind === 'busy' ? 'Creating…' : 'Create invite link'}
      </button>
      {state.kind === 'error' ? <ErrorText>{state.message}</ErrorText> : null}
    </div>
  );
}

/**
 * True once `ref` has scrolled out of view: the phone's floating "Add expense" appears only when
 * the buttons under the bill are gone, so there's never two of them on screen.
 */
function useScrolledPast(ref: RefObject<HTMLElement | null>, ready: boolean): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) =>
      setPast(!entry!.isIntersecting && entry!.boundingClientRect.top < 0),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, ready]);
  return past;
}

export function GroupScreen({ groupId }: { groupId: string }) {
  const view = useData(
    () => loadGroupView(dataStore().group(groupId), dataStore().planningUserId(), todayIsoDate()),
    [groupId],
  );
  const loading = useData(
    () => !dataStore().getStatus().loadedFromServer && dataStore().getStatus().refreshing,
  );
  useScreenOpen(view?.group.name ?? 'Group');
  const actionsRef = useRef<HTMLDivElement>(null);
  const showFab = useScrolledPast(actionsRef, !!view);

  if (!view) {
    if (loading) return <Spinner label="Loading the group…" />;
    return (
      <Message title="Group not found">
        <p className="muted">It was deleted, or you’re no longer in it.</p>
        <Link href="/" className="btn">
          Go to my groups
        </Link>
      </Message>
    );
  }

  const balance = describeMyBalance(view.myBalance, view.group.currency);
  const nameOf = (id: string) => (id === view.me ? 'You' : (view.names.get(id) ?? 'Someone'));
  const currency = view.group.currency;
  const people = view.activeMembers.map((m) => ({ id: m.id, name: m.name }));

  const whoOwes =
    view.transfers.length > 0 ? (
      <Card flush>
        <CardHead title="Who owes whom" />
        {view.transfers.map((t) => {
          const involvesMe = t.fromMemberId === view.me || t.toMemberId === view.me;
          const from = nameOf(t.fromMemberId);
          const to = t.toMemberId === view.me ? 'you' : nameOf(t.toMemberId);
          return (
            <div key={`${t.fromMemberId}-${t.toMemberId}`} className="list-row static">
              <Avatar name={view.names.get(t.fromMemberId) ?? '?'} seed={t.fromMemberId} />
              <div className="grow">
                <div className="row-title ellipsis">
                  {t.fromMemberId === view.me ? `You pay ${to}` : `${from} pays ${to}`}
                </div>
                <div className="row-sub amount">{formatMoney(t.amountPaise, currency)}</div>
              </div>
              {view.canEdit && involvesMe ? (
                <Link
                  href={`/groups/${groupId}/settle?from=${t.fromMemberId}&to=${t.toMemberId}&amount=${t.amountPaise}`}
                  className="btn small secondary"
                >
                  {t.fromMemberId === view.me ? 'Pay' : 'Record'}
                </Link>
              ) : null}
            </div>
          );
        })}
      </Card>
    ) : view.expenseCount > 0 ? (
      <div className="banner info">
        <Icon name="check" /> Everyone is settled up.
      </div>
    ) : null;

  return (
    <>
      <div className="page-head">
        <Link href="/" className="icon-btn" aria-label="Back to groups">
          <Icon name="back" />
        </Link>
        <div className="grow">
          <h1 className="ellipsis">{view.group.name}</h1>
          <p className="small muted ellipsis">
            {people.length} {people.length === 1 ? 'person' : 'people'}
          </p>
        </div>
      </div>

      <div className="group-layout">
        <div className="group-side">
          <div className="bill">
            <span className="bill-label">{capitalize(balance.lead)}</span>
            <span className="bill-amount">{balance.amount ?? 'Nothing owed'}</span>
            <hr className="perforation" />
            <div className="bill-foot">
              <AvatarStack people={people} />
              <span>Spent {formatMoney(view.totalSpent, currency)}</span>
            </div>
          </div>

          {view.canEdit ? (
            <div className="actions" ref={actionsRef}>
              <Link href={`/groups/${groupId}/expenses/new`} className="btn">
                <Icon name="plus" size={18} /> Add expense
              </Link>
              <Link href={`/groups/${groupId}/settle`} className="btn secondary">
                <Icon name="swap" size={18} /> Settle up
              </Link>
            </div>
          ) : (
            <div className="banner warn">
              You’re no longer in this group. You can look, but not change anything.
            </div>
          )}

          {whoOwes}

          <Card className="hide-mobile">
            <PeopleList view={view} nameOf={nameOf} groupId={groupId} />
          </Card>
        </div>

        <div className="group-main">
          <Card flush>
            <CardHead title="Expenses" />
            {view.history.length === 0 && !view.settled ? (
              <div className="center">
                <p className="muted">No expenses yet. Add the first one, like a cab or dinner.</p>
                {view.canEdit ? (
                  <Link href={`/groups/${groupId}/expenses/new`} className="btn small">
                    Add expense
                  </Link>
                ) : null}
              </div>
            ) : (
              <HistoryList rows={view.history} view={view} groupId={groupId} />
            )}
            {view.settled ? (
              <details className="settled">
                <summary>
                  Settled up through {view.settled.through}: {view.settled.expenseCount}{' '}
                  {view.settled.expenseCount === 1 ? 'expense' : 'expenses'},{' '}
                  {formatMoney(view.settled.total, currency)}
                </summary>
                <HistoryList rows={view.settled.history} view={view} groupId={groupId} />
              </details>
            ) : null}
          </Card>

          <Card className="show-mobile-only">
            <PeopleList view={view} nameOf={nameOf} groupId={groupId} />
          </Card>

          {view.canEdit ? (
            <Card>
              <CardHead title="Invite people" />
              <Invite groupId={groupId} groupName={view.group.name} />
            </Card>
          ) : null}
        </div>
      </div>

      {view.canEdit && showFab ? (
        <Link href={`/groups/${groupId}/expenses/new`} className="btn fab">
          <Icon name="plus" size={18} /> Add expense
        </Link>
      ) : null}
    </>
  );
}

function PeopleList({
  view,
  nameOf,
  groupId,
}: {
  view: View;
  nameOf: (id: string) => string;
  groupId: string;
}) {
  const currency = view.group.currency;
  return (
    <>
      <CardHead title="People" />
      <div className="stack">
        {view.memberBalances.map((m) => {
          const amount = m.balance;
          return (
            <div key={m.id} className="row">
              <Avatar name={view.names.get(m.id) ?? '?'} seed={m.id} />
              <span className="grow ellipsis">{nameOf(m.id)}</span>
              <span
                className={`small amount ${amount > 0 ? 'positive' : amount < 0 ? 'negative' : 'muted'}`}
              >
                {amount > 0
                  ? `gets back ${formatMoney(amount, currency)}`
                  : amount < 0
                    ? `owes ${formatMoney(-amount, currency)}`
                    : 'settled'}
              </span>
            </div>
          );
        })}
      </div>
      {view.canEdit ? <AddPerson groupId={groupId} currency={currency} /> : null}
    </>
  );
}
