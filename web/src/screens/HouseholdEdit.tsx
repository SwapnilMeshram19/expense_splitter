/**
 * Add a home service, or edit one. Form state and the price history come from the shared
 * src/features/household/serviceForm.ts, exactly as in the app.
 */
import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';

import { dataStore } from '@/data';
import { runCommand, useData } from '@/data/hooks';
import { currencyPrefix, sanitizeMoneyInput } from '@/domain/currency';
import {
  MAX_SERVICE_NAME_LENGTH,
  monthOf,
  monthStart,
  SERVICE_UNITS,
  unitStep,
  unitWord,
  type ServiceKind,
  type ServiceUnit,
} from '@/domain/household';
import type { HouseholdService } from '@/domain/model';
import { nameIn } from '@/features/household/actions';
import { describeHouseholdError } from '@/features/household/messages';
import {
  initialForm,
  priceChanged,
  TEMPLATES,
  toFields,
  type PriceFrom,
  type ServiceFormState,
} from '@/features/household/serviceForm';
import { formatIsoDate, todayIsoDate } from '@/lib/dates';
import { newId } from '@/lib/newId';

import { useScreenOpen } from '../ui/hooks';
import { Card, ErrorText, Field, Icon, Message, Segmented, Spinner } from '../ui/kit';
import { Stepper } from '../ui/Stepper';

const KINDS: readonly { value: ServiceKind; label: string }[] = [
  { value: 'per_unit', label: 'Per unit' },
  { value: 'monthly', label: 'Monthly fee' },
];
const UNIT_LABELS: Record<ServiceUnit, string> = {
  L: 'Litre',
  kg: 'Kg',
  packet: 'Packet',
  can: 'Can',
  paper: 'Paper',
  item: 'Item',
};
// Monday first, as on the calendar; bit = Date#getDay().
const DAYS = [
  { bit: 1, short: 'M', name: 'Monday' },
  { bit: 2, short: 'T', name: 'Tuesday' },
  { bit: 3, short: 'W', name: 'Wednesday' },
  { bit: 4, short: 'T', name: 'Thursday' },
  { bit: 5, short: 'F', name: 'Friday' },
  { bit: 6, short: 'S', name: 'Saturday' },
  { bit: 0, short: 'S', name: 'Sunday' },
];
const PRICE_FROM: readonly { value: PriceFrom; label: string }[] = [
  { value: 'month', label: '1st of this month' },
  { value: 'today', label: 'Today' },
  { value: 'start', label: 'All days' },
];

export function HouseholdEditScreen({
  groupId,
  serviceId,
}: {
  groupId: string;
  serviceId: string | null;
}) {
  useScreenOpen(serviceId ? 'Edit service' : 'Add a service');
  const setup = useData(() => {
    const snapshot = dataStore().group(groupId);
    if (!snapshot) return null;
    const service = serviceId
      ? (snapshot.householdServices.find((h) => h.id === serviceId.toLowerCase()) ?? null)
      : null;
    return {
      service,
      currency: snapshot.group.currency,
      missing: serviceId !== null && service === null,
    };
  }, [groupId, serviceId]);

  if (!setup)
    return dataStore().getStatus().loadedFromServer ? (
      <Message title="This group isn’t available." />
    ) : (
      <Spinner />
    );
  if (setup.missing) return <Message title="This service no longer exists." />;
  return (
    <ServiceForm
      key={setup.service?.id ?? 'new'}
      groupId={groupId}
      service={setup.service}
      currency={setup.currency}
    />
  );
}

function ServiceForm({
  groupId,
  service: live,
  currency,
}: {
  groupId: string;
  service: HouseholdService | null;
  currency: string;
}) {
  const [, navigate] = useLocation();
  // The version the form was opened on: if someone else saves meanwhile, ours is refused as STALE
  // (and the message says to check it) instead of silently overwriting their change.
  const [service] = useState(live);
  const today = todayIsoDate();
  const [state, setState] = useState<ServiceFormState>(() => initialForm(service, today, currency));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<ServiceFormState>) => {
    setState((s) => ({ ...s, ...patch }));
    setError(null);
  };
  const monthly = state.kind === 'monthly';
  const firstOfMonth = monthStart(monthOf(today));
  const back = service ? `/groups/${groupId}/home/${service.id}` : `/groups/${groupId}/home`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const built = toFields(state, service, today, currency);
    if (!built.ok) return setError(built.message);
    setBusy(true);
    const result = service
      ? await runCommand('household.update', {
          groupId,
          serviceId: service.id,
          expectedVersion: service.version,
          ...built.fields,
        })
      : await runCommand('household.create', { groupId, id: newId(), ...built.fields });
    setBusy(false);
    if (!result.ok)
      return setError(describeHouseholdError(result.error, nameIn(groupId), currency));
    navigate(`/groups/${groupId}/home/${result.entityId}`, { replace: !service });
  };

  const remove = async () => {
    if (!service) return;
    if (
      !window.confirm(
        `Remove ${service.name}? Its days are removed. Bills already posted stay in the group.`,
      )
    )
      return;
    const result = await runCommand('household.delete', {
      groupId,
      serviceId: service.id,
      expectedVersion: service.version,
    });
    if (result.ok) navigate(`/groups/${groupId}/home`, { replace: true });
    else setError(describeHouseholdError(result.error, nameIn(groupId), currency));
  };

  return (
    <form className="narrow stack" onSubmit={(e) => void submit(e)}>
      <div className="page-head">
        <Link href={back} className="icon-btn" aria-label="Back">
          <Icon name="back" />
        </Link>
        <h1 className="grow ellipsis">{service ? `Edit ${service.name}` : 'Add a service'}</h1>
      </div>

      {!service ? (
        <div className="pills" role="group" aria-label="Start from">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              type="button"
              className="pill"
              aria-pressed={state.name === t.patch.name}
              onClick={() => update(t.patch)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <Card>
        <div className="stack">
          <Field label="Name">
            <input
              className="input"
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="Milk, Maid, Newspaper…"
              maxLength={MAX_SERVICE_NAME_LENGTH}
            />
          </Field>

          <Segmented
            label="How it’s paid"
            value={state.kind}
            options={KINDS}
            onChange={(kind) => update({ kind })}
          />

          {!monthly ? (
            <>
              <Field label="Counted in">
                <select
                  className="input"
                  value={state.unit}
                  onChange={(e) => {
                    const unit = e.target.value as ServiceUnit;
                    const step = unitStep(unit);
                    update({
                      unit,
                      defaultQty: Math.max(step, Math.round(state.defaultQty / step) * step),
                    });
                  }}
                >
                  {SERVICE_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u]}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="stack">
                <span className="small muted">Usually a day</span>
                <Stepper
                  value={state.defaultQty}
                  step={unitStep(state.unit)}
                  min={unitStep(state.unit)}
                  unit={unitWord(state.unit)}
                  label="usual quantity a day"
                  onChange={(defaultQty) => update({ defaultQty })}
                />
              </div>
            </>
          ) : null}

          <Field label={monthly ? 'Monthly fee' : `Price per ${unitWord(state.unit)}`}>
            <input
              className="input amount-input"
              inputMode="decimal"
              value={state.priceText}
              onChange={(e) =>
                update({ priceText: sanitizeMoneyInput(e.target.value, state.priceText, currency) })
              }
              placeholder={`${currencyPrefix(currency)} 0`}
            />
          </Field>
          {priceChanged(state, service, today, currency) ? (
            <div className="stack">
              <span className="small muted">New price applies from</span>
              <div className="pills">
                {PRICE_FROM.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    className="pill"
                    aria-pressed={state.priceFrom === p.value}
                    onClick={() => update({ priceFrom: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {monthly ? (
            <div className="stack">
              <span className="small muted">Paid leaves a month</span>
              <Stepper
                value={state.paidLeaves * 100}
                step={100}
                max={3100}
                unit={state.paidLeaves === 1 ? 'day' : 'days'}
                label="paid leaves a month"
                onChange={(v) => update({ paidLeaves: v / 100 })}
              />
              <small className="muted">
                Absences beyond these are cut from the fee, day by day.
              </small>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="stack">
          <span className="small muted">{monthly ? 'Works on' : 'Comes on'}</span>
          <div className="pills" role="group" aria-label={monthly ? 'Works on' : 'Comes on'}>
            {DAYS.map((d) => (
              <button
                key={d.name}
                type="button"
                className="pill day"
                aria-label={d.name}
                aria-pressed={(state.weekdays & (1 << d.bit)) !== 0}
                onClick={() => update({ weekdays: state.weekdays ^ (1 << d.bit) })}
              >
                {d.short}
              </button>
            ))}
          </div>

          <span className="small muted">Started on</span>
          <div className="pills">
            <button
              type="button"
              className="pill"
              aria-pressed={state.startDate === firstOfMonth}
              onClick={() => update({ startDate: firstOfMonth })}
            >
              1st of this month
            </button>
            <button
              type="button"
              className="pill"
              aria-pressed={state.startDate === today}
              onClick={() => update({ startDate: today })}
            >
              Today
            </button>
            <input
              type="date"
              className="input"
              style={{ width: 'auto' }}
              value={state.startDate}
              onChange={(e) => e.target.value && update({ startDate: e.target.value })}
              aria-label="Start date"
            />
          </div>

          {service ? (
            <>
              <span className="small muted">Status</span>
              <div className="pills">
                <button
                  type="button"
                  className="pill"
                  aria-pressed={state.endDate === null}
                  onClick={() => update({ endDate: null })}
                >
                  Ongoing
                </button>
                <button
                  type="button"
                  className="pill"
                  aria-pressed={state.endDate !== null}
                  onClick={() => update({ endDate: state.endDate ?? today })}
                >
                  {state.endDate ? `Stopped ${formatIsoDate(state.endDate)}` : 'Stopped today'}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </Card>

      <ErrorText>{error}</ErrorText>
      <div className="row wrap">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? 'Saving…' : service ? 'Save' : 'Add service'}
        </button>
        {service ? (
          <button type="button" className="btn danger" onClick={() => void remove()}>
            Remove
          </button>
        ) : null}
      </div>
      <p className="small muted">
        Everyone in the group sees and can mark it. Needs internet to save.
      </p>
    </form>
  );
}
