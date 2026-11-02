/**
 * Home services in the browser: today's milk, maid, newspaper… (list), and one service's month
 * with its bill (calendar). Same shared rules and view models as the app
 * (src/domain/household.ts, src/features/household/view.ts), so a bill computes to the same paisa.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';

import { currentUserId, dataStore } from '@/data';
import { runCommand, useData } from '@/data/hooks';
import { formatMoney } from '@/domain/currency';
import {
  billDescription,
  formatQty,
  formatQtyWithUnit,
  markId,
  monthLabel,
  monthOf,
  unitStep,
  unitWord,
  usualQty,
} from '@/domain/household';
import { saveMark, nameIn } from '@/features/household/actions';
import { describeHouseholdError } from '@/features/household/messages';
import {
  billUpTo,
  defaultBillPeople,
  loadHouseholdList,
  loadServiceMonth,
  type CalendarDay,
  type ServiceToday,
} from '@/features/household/view';
import { clampShareText } from '@/features/share/whatsapp';
import { formatDayLine, formatIsoDate, fromIsoDate, todayIsoDate } from '@/lib/dates';
import { newId } from '@/lib/newId';

import { useScreenOpen } from '../ui/hooks';
import { Card, CardHead, ErrorText, Icon, Message, Spinner } from '../ui/kit';
import { Stepper } from '../ui/Stepper';

// ── List ───────────────────────────────────────────────────────────────

export function HouseholdScreen({ groupId }: { groupId: string }) {
  useScreenOpen('Home services');
  const today = todayIsoDate();
  const view = useData(
    () => loadHouseholdList(dataStore().group(groupId), currentUserId(), today),
    [groupId, today],
  );
  const [error, setError] = useState<string | null>(null);

  if (!view)
    return dataStore().getStatus().loadedFromServer ? (
      <Message title="This group isn’t available." />
    ) : (
      <Spinner />
    );
  const canEdit = view.me !== null;

  const setToday = async (item: ServiceToday, qty: number) => {
    setError(null);
    const message = await saveMark(
      groupId,
      item.service.id,
      today,
      qty === item.usual ? null : qty,
    );
    if (message) setError(message);
  };

  return (
    <div className="narrow stack">
      <div className="page-head">
        <Link href={`/groups/${groupId}`} className="icon-btn" aria-label="Back to the group">
          <Icon name="back" />
        </Link>
        <div className="grow">
          <h1>Home services</h1>
          <p className="small muted">{formatDayLine(new Date())}</p>
        </div>
        {canEdit && view.items.length > 0 ? (
          <Link href={`/groups/${groupId}/home/new`} className="btn small">
            <Icon name="plus" size={16} /> Add
          </Link>
        ) : null}
      </div>
      <ErrorText>{error}</ErrorText>

      {view.items.length === 0 ? (
        <Card>
          <div className="center">
            <h2>Milk, maid, newspaper…</h2>
            <p className="muted">
              Every day counts as usual. Only mark the days that change, and post the month’s bill
              to the group.
            </p>
            {canEdit ? (
              <Link href={`/groups/${groupId}/home/new`} className="btn">
                <Icon name="plus" size={18} /> Add a service
              </Link>
            ) : null}
          </div>
        </Card>
      ) : (
        view.items.map((item) => (
          <ServiceCard
            key={item.service.id}
            groupId={groupId}
            item={item}
            currency={view.currency}
            canEdit={canEdit}
            onSet={(qty) => setToday(item, qty)}
          />
        ))
      )}
    </div>
  );
}

function ServiceCard({
  groupId,
  item,
  currency,
  canEdit,
  onSet,
}: {
  groupId: string;
  item: ServiceToday;
  currency: string;
  canEdit: boolean;
  onSet: (qty: number) => Promise<void>;
}) {
  const { service } = item;
  const monthly = service.kind === 'monthly';
  const queued = useData(
    () => dataStore().pendingStatus(markId(service.id, todayIsoDate())) === 'queued',
    [service.id],
  );
  // − / + clicks settle for a moment before saving: "2.5 L" is one save, not three.
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const changeQty = (next: number) => {
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (next === item.qty) setDraft(null);
      else void onSet(next).finally(() => setDraft(null));
    }, 700);
  };
  const showControls = canEdit && item.active && (!monthly || item.scheduled);

  return (
    <Card flush>
      <Link href={`/groups/${groupId}/home/${service.id}`} className="list-row">
        <div className="grow">
          <div className="row-title ellipsis">{service.name}</div>
          <div className={`row-sub ellipsis${item.qty !== item.usual ? ' warning' : ''}`}>
            {item.status}
            {queued ? ' · not sent yet' : ''}
          </div>
        </div>
        <div className="row-end">
          <div className="amount">{formatMoney(item.monthAmount, currency)}</div>
          <div className={item.billChanged ? 'warning' : 'muted'}>
            {item.billChanged ? 'Bill changed' : 'This month'}
          </div>
        </div>
        <Icon name="forward" size={18} />
      </Link>
      {showControls ? (
        <div className="service-controls">
          {monthly ? (
            <div className="pills" role="group" aria-label={`${service.name} today`}>
              <button
                type="button"
                className="pill"
                aria-pressed={item.qty > 0}
                onClick={() => item.qty === 0 && void onSet(item.usual)}
              >
                Came
              </button>
              <button
                type="button"
                className="pill"
                aria-pressed={item.qty === 0}
                onClick={() => item.qty > 0 && void onSet(0)}
              >
                Absent
              </button>
            </div>
          ) : (
            <Stepper
              value={draft ?? item.qty}
              step={unitStep(service.unit)}
              unit={unitWord(service.unit)}
              label={`${service.name} today`}
              onChange={changeQty}
            />
          )}
        </div>
      ) : null}
    </Card>
  );
}

// ── One service: calendar and bill ─────────────────────────────────────

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SPOKEN: Record<CalendarDay['state'], string> = {
  usual: 'as usual',
  absent: 'absent',
  more: 'more than usual',
  less: 'less than usual',
  off: 'off',
};

export function ServiceScreen({ groupId, serviceId }: { groupId: string; serviceId: string }) {
  const today = todayIsoDate();
  const [month, setMonth] = useState(monthOf(today));
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const [posting, setPosting] = useState(false);
  const view = useData(
    () => loadServiceMonth(dataStore().group(groupId), serviceId, month, currentUserId(), today),
    [groupId, serviceId, month, today],
  );
  useScreenOpen(view?.service.name ?? 'Home service');

  if (!view) {
    return dataStore().getStatus().loadedFromServer ? (
      <Message title="This service no longer exists.">
        <Link href={`/groups/${groupId}/home`} className="btn">
          Home services
        </Link>
      </Message>
    ) : (
      <Spinner />
    );
  }

  const { service, bill, currency, posted } = view;
  const money = (minor: number) => formatMoney(minor, currency);
  const canEdit = view.me !== null;
  const goMonth = (m: string | null) => {
    if (!m) return;
    setMonth(m);
    setSelected(null);
    setPosting(false);
  };
  const billText = () =>
    clampShareText(
      [
        `${billDescription(service.name, month)}: ${bill ? money(bill.amountPaise) : ''}`,
        ...view.billText,
      ].join('\n'),
    );

  return (
    <div className="narrow stack">
      <div className="page-head">
        <Link
          href={`/groups/${groupId}/home`}
          className="icon-btn"
          aria-label="Back to home services"
        >
          <Icon name="back" />
        </Link>
        <h1 className="grow ellipsis">{service.name}</h1>
        {canEdit ? (
          <Link
            href={`/groups/${groupId}/home/${service.id}/edit`}
            className="icon-btn"
            aria-label="Edit service"
          >
            <Icon name="edit" />
          </Link>
        ) : null}
      </div>

      <Card>
        <div className="stack">
          <div className="month-nav">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous month"
              disabled={!view.prevMonth}
              onClick={() => goMonth(view.prevMonth)}
            >
              <Icon name="back" />
            </button>
            <h2 aria-live="polite">{monthLabel(month)}</h2>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next month"
              disabled={!view.nextMonth}
              onClick={() => goMonth(view.nextMonth)}
            >
              <Icon name="forward" />
            </button>
          </div>

          <div className="calendar">
            {WEEK.map((d) => (
              <span key={d} className="weekday" aria-hidden="true">
                {d.charAt(0)}
              </span>
            ))}
            {Array.from({ length: view.leadingBlanks }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {view.days.map((d) => {
              const mark =
                d.state === 'absent'
                  ? '×'
                  : service.kind === 'per_unit' && (d.state === 'more' || d.state === 'less')
                    ? formatQty(d.qty)
                    : null;
              return (
                <button
                  key={d.date}
                  type="button"
                  className={`cal-day ${d.state}${d.isToday ? ' today' : ''}${selected?.date === d.date ? ' selected' : ''}`}
                  disabled={!canEdit || !d.editable}
                  aria-label={`${formatIsoDate(d.date)}, ${SPOKEN[d.state]}${d.isToday ? ', today' : ''}`}
                  aria-pressed={selected?.date === d.date}
                  onClick={() => setSelected(d)}
                >
                  {d.day}
                  {mark ? <small>{mark}</small> : null}
                </button>
              );
            })}
          </div>
          <p className="small muted">
            {canEdit ? 'Click a day to change it. ' : ''}
            {service.kind === 'monthly' ? '× = absent.' : '× = none, numbers = a different amount.'}
          </p>

          {selected ? (
            <DayPanel
              key={selected.date}
              groupId={groupId}
              serviceId={service.id}
              day={selected}
              onDone={() => setSelected(null)}
            />
          ) : null}
        </div>
      </Card>

      {bill ? (
        <Card>
          <div className="stack">
            <span className="small muted">
              {bill.complete ? 'Bill' : `Bill till ${formatIsoDate(bill.upTo)}`}
            </span>
            <span className="big-amount">{money(bill.amountPaise)}</span>
            <ul className="bill-lines">
              {view.billText.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {posted ? (
              <p className={`small ${view.billChanged ? 'warning' : 'positive'}`}>
                {view.billChanged
                  ? `Posted to the group as ${money(posted.amountPaise)}. The days changed since.`
                  : 'Posted to the group.'}
              </p>
            ) : null}

            {posting ? (
              <PostBill
                groupId={groupId}
                serviceId={service.id}
                month={month}
                upTo={billUpTo(month, today)}
                amount={money(bill.amountPaise)}
                onDone={() => setPosting(false)}
              />
            ) : (
              <div className="row wrap">
                {view.canPost ? (
                  <button type="button" className="btn" onClick={() => setPosting(true)}>
                    {posted ? 'Update the posted bill' : 'Post to the group'}
                  </button>
                ) : null}
                {posted ? (
                  <Link href={`/groups/${groupId}/expenses/${posted.id}`} className="btn secondary">
                    Open expense
                  </Link>
                ) : null}
                {bill.amountPaise > 0 ? <ShareBill getText={billText} /> : null}
              </div>
            )}
          </div>
        </Card>
      ) : (
        <p className="muted small">
          Mark days ahead, like “no milk” while you travel. The bill shows once the month starts.
        </p>
      )}
    </div>
  );
}

/** Change one day: usual, none / absent, or another amount. */
function DayPanel({
  groupId,
  serviceId,
  day,
  onDone,
}: {
  groupId: string;
  serviceId: string;
  day: CalendarDay;
  onDone: () => void;
}) {
  const service = useData(
    () =>
      dataStore()
        .group(groupId)
        ?.householdServices.find((h) => h.id === serviceId) ?? null,
    [groupId, serviceId],
  );
  const [qty, setQty] = useState(day.qty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!service) return null;
  const usual = usualQty(service, day.date);

  const save = async (value: number | null) => {
    setBusy(true);
    setError(null);
    const message = await saveMark(groupId, serviceId, day.date, value);
    setBusy(false);
    if (message) setError(message);
    else onDone();
  };

  return (
    <div className="day-panel stack" role="region" aria-label={`Change ${formatIsoDate(day.date)}`}>
      <strong>{formatDayLine(fromIsoDate(day.date))}</strong>
      {service.kind === 'monthly' ? (
        <div className="pills">
          <button
            type="button"
            className="pill"
            aria-pressed={day.state !== 'absent'}
            disabled={busy}
            onClick={() => void save(null)}
          >
            Came
          </button>
          <button
            type="button"
            className="pill"
            aria-pressed={day.state === 'absent'}
            disabled={busy}
            onClick={() => void save(0)}
          >
            Absent
          </button>
        </div>
      ) : (
        <>
          <div className="pills">
            <button
              type="button"
              className="pill"
              aria-pressed={day.state === 'usual' || (day.state === 'off' && day.qty === 0)}
              disabled={busy}
              onClick={() => void save(null)}
            >
              {usual > 0 ? `Usual (${formatQtyWithUnit(usual, service.unit)})` : 'Usual (none)'}
            </button>
            {usual > 0 ? (
              <button
                type="button"
                className="pill"
                aria-pressed={day.state === 'absent'}
                disabled={busy}
                onClick={() => void save(0)}
              >
                None
              </button>
            ) : null}
          </div>
          <div className="row wrap">
            <Stepper
              value={qty}
              step={unitStep(service.unit)}
              unit={unitWord(service.unit)}
              label={`${service.name} on ${formatIsoDate(day.date)}`}
              onChange={setQty}
            />
            <button
              type="button"
              className="btn small"
              disabled={busy || qty === day.qty}
              onClick={() => void save(qty)}
            >
              Save
            </button>
          </div>
        </>
      )}
      <div className="row">
        <button type="button" className="btn small ghost" onClick={onDone}>
          Close
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Who paid the vendor and who shares the bill (equal split), then post or update. */
function PostBill({
  groupId,
  serviceId,
  month,
  upTo,
  amount,
  onDone,
}: {
  groupId: string;
  serviceId: string;
  month: string;
  upTo: string;
  amount: string;
  onDone: () => void;
}) {
  const setup = useData(() => {
    const snapshot = dataStore().group(groupId);
    const service = snapshot?.householdServices.find((h) => h.id === serviceId);
    if (!snapshot || !service) return null;
    const postedId = service.bills[month];
    const posted = postedId ? (snapshot.expenses.find((e) => e.id === postedId) ?? null) : null;
    const me =
      snapshot.members.find((m) => m.userId === currentUserId() && m.deletedAt === null)?.id ??
      null;
    return {
      currency: snapshot.group.currency,
      service,
      posted,
      members: snapshot.members.filter((m) => m.deletedAt === null),
      defaults: defaultBillPeople(snapshot, posted, me),
    };
  }, [groupId, serviceId, month]);
  // Versions as the sheet was opened: a bill someone else posts or edits meanwhile is refused
  // (STALE), never silently overwritten with this person's payer and split.
  const [base] = useState(() => ({
    service: setup?.service.version ?? 0,
    posted: setup?.posted?.version ?? null,
  }));
  const [paidBy, setPaidBy] = useState(setup?.defaults.paidBy ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(setup?.defaults.memberIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!setup) return null;

  const toggle = (id: string) =>
    setMemberIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const post = async () => {
    setBusy(true);
    setError(null);
    const result = await runCommand('household.postBill', {
      groupId,
      serviceId,
      expectedVersion: base.service,
      month,
      upTo,
      expenseId: newId(),
      expectedExpenseVersion: base.posted,
      paidByMemberId: paidBy,
      memberIds,
    });
    setBusy(false);
    if (result.ok) onDone();
    else setError(describeHouseholdError(result.error, nameIn(groupId), setup.currency));
  };

  return (
    <div className="day-panel stack">
      <CardHead title={setup.posted ? `Update to ${amount}` : `Post ${amount}`} />
      <label className="field">
        <span>Paid by</span>
        <select className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {setup.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted">Split equally between</legend>
        {setup.members.map((m) => (
          <label key={m.id} className="check-row">
            <input
              type="checkbox"
              checked={memberIds.includes(m.id)}
              onChange={() => toggle(m.id)}
            />
            <span>{m.displayName}</span>
          </label>
        ))}
      </fieldset>
      <div className="row wrap">
        <button
          type="button"
          className="btn"
          disabled={busy || !paidBy || memberIds.length === 0}
          onClick={() => void post()}
        >
          {busy ? 'Saving…' : setup.posted ? 'Update expense' : 'Add as expense'}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="small muted">
        It’s an ordinary expense: balances and settle-up include it. Needs internet.
      </p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** WhatsApp (wa.me works on phones and WhatsApp Web), else the system share sheet or a copy. */
function ShareBill({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const other = async () => {
    const text = getText();
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // dismissed: copy instead
      }
    }
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
  };
  return (
    <>
      <a
        className="btn secondary"
        href={`https://wa.me/?text=${encodeURIComponent(getText())}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp
      </a>
      <button type="button" className="btn ghost" onClick={() => void other()}>
        <Icon name="share" size={18} /> {copied ? 'Copied' : 'Share'}
      </button>
    </>
  );
}
