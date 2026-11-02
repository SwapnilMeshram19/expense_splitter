/**
 * The add / edit form for a home service, as plain state (testable without React Native).
 */
import { minorToInputString, parseAmount } from '@/domain/currency';
import {
  ALL_WEEKDAYS,
  currentRate,
  monthOf,
  monthStart,
  QTY_SCALE,
  withPriceFrom,
  withStartDate,
  type ServiceFields,
  type ServiceKind,
  type ServiceUnit,
} from '@/domain/household';
import type { HouseholdService } from '@/domain/model';

/** When a new price starts. "month" is how most milk and newspaper hikes work in India. */
export type PriceFrom = 'month' | 'today' | 'start';

export interface ServiceFormState {
  name: string;
  kind: ServiceKind;
  unit: ServiceUnit;
  defaultQty: number;
  priceText: string;
  priceFrom: PriceFrom;
  weekdays: number;
  paidLeaves: number;
  startDate: string;
  endDate: string | null;
}

export interface Template {
  label: string;
  patch: Partial<ServiceFormState>;
}

/** One tap fills the usual setup; everything stays editable. */
export const TEMPLATES: readonly Template[] = [
  { label: 'Milk', patch: { name: 'Milk', kind: 'per_unit', unit: 'L', defaultQty: QTY_SCALE } },
  {
    label: 'Newspaper',
    patch: { name: 'Newspaper', kind: 'per_unit', unit: 'paper', defaultQty: QTY_SCALE },
  },
  {
    label: 'Water can',
    patch: { name: 'Water can', kind: 'per_unit', unit: 'can', defaultQty: QTY_SCALE },
  },
  { label: 'Maid', patch: { name: 'Maid', kind: 'monthly', paidLeaves: 2 } },
  { label: 'Cook', patch: { name: 'Cook', kind: 'monthly', paidLeaves: 2 } },
];

export function initialForm(
  service: HouseholdService | null,
  today: string,
  currency: string,
): ServiceFormState {
  if (!service) {
    return {
      name: '',
      kind: 'per_unit',
      unit: 'L',
      defaultQty: QTY_SCALE,
      priceText: '',
      priceFrom: 'month',
      weekdays: ALL_WEEKDAYS,
      paidLeaves: 2,
      // Most people start tracking mid-month for a service they've had all month.
      startDate: monthStart(monthOf(today)),
      endDate: null,
    };
  }
  return {
    name: service.name,
    kind: service.kind,
    unit: service.unit ?? 'L',
    defaultQty: service.kind === 'monthly' ? QTY_SCALE : service.defaultQty,
    priceText: minorToInputString(currentRate(service.rates, today), currency),
    priceFrom: 'month',
    weekdays: service.weekdays,
    paidLeaves: service.kind === 'monthly' ? service.paidLeaves : 2,
    startDate: service.startDate,
    endDate: service.endDate,
  };
}

/** The price typed differs from the one in force today (so: from when?). */
export function priceChanged(
  state: ServiceFormState,
  service: HouseholdService | null,
  today: string,
  currency: string,
): boolean {
  if (!service) return false;
  const parsed = parseAmount(state.priceText, currency);
  return parsed.ok && parsed.minor !== currentRate(service.rates, today);
}

export const PRICE_ERRORS: Record<string, string> = {
  EMPTY: 'Enter the price.',
  ZERO: 'Enter the price.',
  INVALID: 'Enter a valid price.',
  TOO_MANY_DECIMALS: 'Too many decimals in the price.',
  TOO_LARGE: 'That price is too large.',
};

/** Form → command fields. Price history is kept: a new price starts on a date, older days keep theirs. */
export function toFields(
  state: ServiceFormState,
  service: HouseholdService | null,
  today: string,
  currency: string,
): { ok: true; fields: ServiceFields } | { ok: false; message: string } {
  const parsed = parseAmount(state.priceText, currency);
  if (!parsed.ok)
    return { ok: false, message: PRICE_ERRORS[parsed.error] ?? 'Enter a valid price.' };
  const start = state.startDate;

  let rates = [{ from: start, ratePaise: parsed.minor }];
  if (service) {
    const base = start === service.startDate ? service.rates : withStartDate(service.rates, start);
    const latest = (a: string, b: string) => (a > b ? a : b);
    const from =
      state.priceFrom === 'start'
        ? start
        : state.priceFrom === 'today'
          ? latest(start, today)
          : latest(start, monthStart(monthOf(today)));
    rates =
      parsed.minor === currentRate(base, today)
        ? base
        : withPriceFrom(base, start, parsed.minor, from);
  }

  const monthly = state.kind === 'monthly';
  return {
    ok: true,
    fields: {
      name: state.name,
      kind: state.kind,
      unit: monthly ? null : state.unit,
      defaultQty: monthly ? QTY_SCALE : state.defaultQty,
      rates,
      weekdays: state.weekdays,
      paidLeaves: monthly ? state.paidLeaves : 0,
      startDate: start,
      endDate: state.endDate,
    },
  };
}
