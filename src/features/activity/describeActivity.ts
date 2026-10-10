/**
 * Turns raw activity_log entries into human-readable sentences.
 * Snapshots are JSON that may come from other devices or older app versions (after sync),
 * so they are parsed defensively: malformed entries degrade to "X made a change".
 */
import type { ActivityLogEntry } from '@/db/schema';
import {
  currencyLabel,
  DEFAULT_CURRENCY,
  formatMoney,
  isSupportedCurrency,
  type CurrencyCode,
} from '@/domain/currency';
import { METHOD_LABELS } from '@/features/settlements/messages';
import { formatIsoDate, toLocalIsoDate } from '@/lib/dates';

export interface ActivityView {
  title: string;
  detail: string | null;
}

export interface ActivityContext {
  /** This device's member id in the group (rendered as "You"/"you"). */
  me: string | null;
  /** Display name for a member id (may include members who left). */
  nameOf: (memberId: string) => string;
  /** The group's currency; amounts in snapshots are its minor units. Default INR. */
  currency?: CurrencyCode;
}

type Json = Record<string, unknown>;
interface Line {
  memberId: string;
  amountPaise: number;
}

const asRecord = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;

/** True when the key is present, even with a null value ("UPI ID removed" is { upiVpa: null }). */
const hasKey = (record: Json | null, key: string): boolean => record !== null && key in record;

function str(record: Json | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function num(record: Json | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(record: Json | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === 'boolean' ? value : null;
}

function lines(record: Json | null, key: string): Line[] | null {
  const value = record?.[key];
  if (!Array.isArray(value)) return null;
  const result: Line[] = [];
  for (const item of value) {
    const line = asRecord(item);
    const memberId = str(line, 'memberId');
    const amountPaise = num(line, 'amountPaise');
    if (memberId === null || amountPaise === null) return null;
    result.push({ memberId, amountPaise });
  }
  return result;
}

/** The foreign-bill part of an expense snapshot ({ currency, amountMinor, rate }), if valid. */
function foreignOf(record: Json | null): { currency: string; amountMinor: number } | null {
  const foreign = asRecord(record?.foreign);
  const currency = str(foreign, 'currency');
  const amountMinor = num(foreign, 'amountMinor');
  if (currency === null || amountMinor === null || !isSupportedCurrency(currency)) return null;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  return { currency, amountMinor };
}

const sameLines = (a: Line[] | null, b: Line[] | null) => {
  const key = (l: Line[] | null) =>
    JSON.stringify([...(l ?? [])].sort((x, y) => (x.memberId < y.memberId ? -1 : 1)));
  return key(a) === key(b);
};

const SPLIT_LABELS: Record<string, string> = {
  equal: 'equally',
  exact: 'amounts',
  percentage: 'percentages',
  shares: 'shares',
  itemized: 'items',
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** '1 Oct 2026, 2:05 pm' in the device's local time. */
export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const hours = date.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatIsoDate(toLocalIsoDate(date))}, ${hour12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}

export function describeActivity(entry: ActivityLogEntry, ctx: ActivityContext): ActivityView {
  /** Name at the start of a sentence ("You", "Rahul"). */
  const subject = (id: string | null) =>
    id === null ? 'Someone' : id === ctx.me ? 'You' : ctx.nameOf(id);
  /** Name mid-sentence ("you", "Rahul"). */
  const object = (id: string) => (id === ctx.me ? 'you' : ctx.nameOf(id));
  const payersText = (payers: Line[] | null) =>
    payers && payers.length > 0 ? payers.map((p) => object(p.memberId)).join(', ') : 'someone';

  const groupCurrency = ctx.currency ?? DEFAULT_CURRENCY;
  const money = (minor: number) => formatMoney(minor, groupCurrency);
  /** "₹2,416" or, for a bill paid in another currency, "$25 (₹2,416)". */
  const expenseAmount = (record: Json | null, minor: number) => {
    const foreign = foreignOf(record);
    return foreign
      ? `${formatMoney(foreign.amountMinor, foreign.currency)} (${money(minor)})`
      : money(minor);
  };

  const actor = subject(entry.actorMemberId);
  const before = asRecord(entry.before);
  const after = asRecord(entry.after);
  const fallback: ActivityView = { title: `${actor} made a change`, detail: null };

  switch (entry.entityType) {
    case 'group': {
      // Written by the server when a deletion was undone (Phase 6.2 balance rule).
      if (entry.action === 'restore') {
        return {
          title: 'The group was restored',
          detail:
            str(after, 'reason') === 'GROUP_HAS_BALANCES'
              ? 'It can’t be deleted while balances aren’t settled.'
              : null,
        };
      }
      if (entry.action === 'create') {
        const name = str(after, 'name');
        const currency = str(after, 'currency');
        return {
          title: `${actor} created the group${name ? ` “${name}”` : ''}`,
          // Rupee groups were the only kind before multi-currency: only call out the others.
          detail:
            currency && currency !== DEFAULT_CURRENCY && isSupportedCurrency(currency)
              ? `Currency: ${currencyLabel(currency)}`
              : null,
        };
      }
      if (entry.action === 'delete') return { title: `${actor} deleted the group`, detail: null };
      if (entry.action === 'update') {
        const oldName = str(before, 'name');
        const newName = str(after, 'name');
        if (oldName !== null && newName !== null) {
          return { title: `${actor} renamed the group`, detail: `${oldName} → ${newName}` };
        }
        const oldCurrency = str(before, 'currency');
        const newCurrency = str(after, 'currency');
        if (oldCurrency !== null && newCurrency !== null) {
          return { title: `${actor} changed the group’s currency`, detail: `${oldCurrency} → ${newCurrency}` };
        }
        const simplify = bool(after, 'simplifyDebts');
        if (simplify !== null) {
          return { title: `${actor} turned debt simplification ${simplify ? 'on' : 'off'}`, detail: null };
        }
      }
      return fallback;
    }

    case 'member': {
      // Written by the server when a removal was undone (Phase 6.2 balance rule).
      if (entry.action === 'restore') {
        const name = str(after, 'displayName') ?? ctx.nameOf(entry.entityId);
        return {
          title: `${name} was added back`,
          detail:
            str(after, 'reason') === 'MEMBER_HAS_BALANCE'
              ? 'They can’t be removed while they still owe or are owed money.'
              : null,
        };
      }

      // UPI ID changes. Values are already masked when logged (see repositories/memberUpi.ts).
      if (entry.action === 'update' && (hasKey(before, 'upiVpa') || hasKey(after, 'upiVpa'))) {
        const target = entry.entityId;
        const whose =
          target === ctx.me ? 'your' : target === entry.actorMemberId ? 'their' : `${ctx.nameOf(target)}’s`;
        const oldVpa = str(before, 'upiVpa');
        const newVpa = str(after, 'upiVpa');
        if (newVpa === null) return { title: `${actor} removed ${whose} UPI ID`, detail: oldVpa };
        return {
          title: `${actor} ${oldVpa === null ? 'added' : 'changed'} ${whose} UPI ID`,
          detail: oldVpa === null ? newVpa : `${oldVpa} → ${newVpa}`,
        };
      }

      const oldName = str(before, 'displayName');
      const newName = str(after, 'displayName');
      if (entry.action === 'create' && newName) return { title: `${actor} added ${newName}`, detail: null };
      if (entry.action === 'update' && oldName && newName) {
        return { title: `${actor} renamed ${oldName} to ${newName}`, detail: null };
      }
      if (entry.action === 'delete' && oldName) return { title: `${actor} removed ${oldName}`, detail: null };
      return fallback;
    }

    case 'expense': {
      if (entry.action === 'create' || entry.action === 'delete') {
        const snapshot = entry.action === 'create' ? after : before;
        const description = str(snapshot, 'description');
        const amount = num(snapshot, 'amountPaise');
        if (description === null || amount === null) return fallback;
        const verb = entry.action === 'create' ? 'added' : 'deleted';
        const paidBy = entry.action === 'create' ? ` · paid by ${payersText(lines(snapshot, 'payers'))}` : '';
        return {
          title: `${actor} ${verb} “${description}”`,
          detail: `${expenseAmount(snapshot, amount)}${paidBy}`,
        };
      }
      if (entry.action === 'update') {
        const description = str(after, 'description');
        if (description === null) return fallback;

        const changes: string[] = [];
        const oldDescription = str(before, 'description');
        if (oldDescription !== null && oldDescription !== description) {
          changes.push(`“${oldDescription}” → “${description}”`);
        }
        const oldAmount = num(before, 'amountPaise');
        const newAmount = num(after, 'amountPaise');
        if (oldAmount !== null && newAmount !== null) {
          // The bill's own amount can change while the converted one doesn't (and vice versa).
          const oldText = expenseAmount(before, oldAmount);
          const newText = expenseAmount(after, newAmount);
          if (oldText !== newText) changes.push(`${oldText} → ${newText}`);
        }
        const oldDate = str(before, 'expenseDate');
        const newDate = str(after, 'expenseDate');
        if (oldDate !== null && newDate !== null && oldDate !== newDate) {
          changes.push(`${formatIsoDate(oldDate)} → ${formatIsoDate(newDate)}`);
        }
        // A custom name wins over the category key ("Other" with label "Petrol" reads "Petrol").
        const categoryText = (record: Json | null) => {
          const category = str(record, 'category');
          if (category === null) return null;
          return (category === 'other' ? str(record, 'categoryLabel') : null) ?? capitalize(category);
        };
        const oldCategory = categoryText(before);
        const newCategory = categoryText(after);
        if (oldCategory !== null && newCategory !== null && oldCategory !== newCategory) {
          changes.push(`${oldCategory} → ${newCategory}`);
        }
        const oldPayers = lines(before, 'payers');
        const newPayers = lines(after, 'payers');
        if (!sameLines(oldPayers, newPayers)) {
          changes.push(`paid by ${payersText(oldPayers)} → ${payersText(newPayers)}`);
        }
        const oldSplitType = str(asRecord(before?.splitInput), 'type');
        const newSplitType = str(asRecord(after?.splitInput), 'type');
        if (oldSplitType !== null && newSplitType !== null && oldSplitType !== newSplitType) {
          changes.push(
            `split ${SPLIT_LABELS[oldSplitType] ?? oldSplitType} → ${SPLIT_LABELS[newSplitType] ?? newSplitType}`,
          );
        } else if (!sameLines(lines(before, 'shares'), lines(after, 'shares'))) {
          changes.push('split changed');
        }

        return {
          title: `${actor} changed “${description}”`,
          detail: changes.length > 0 ? changes.join(' · ') : null,
        };
      }
      return fallback;
    }

    case 'settlement': {
      const snapshot = entry.action === 'delete' ? before : after;
      const from = str(snapshot, 'fromMemberId');
      const to = str(snapshot, 'toMemberId');
      const amount = num(snapshot, 'amountPaise');
      if (from === null || to === null || amount === null) return fallback;
      if (entry.action === 'create') {
        const method = str(snapshot, 'method');
        const methodLabel = method && method in METHOD_LABELS ? METHOD_LABELS[method as keyof typeof METHOD_LABELS] : null;
        return {
          title: `${actor} recorded a payment`,
          detail: `${subject(from)} paid ${object(to)} ${money(amount)}${methodLabel ? ` · ${methodLabel}` : ''}`,
        };
      }
      if (entry.action === 'delete') {
        return {
          title: `${actor} deleted a payment`,
          detail: `${subject(from)} → ${object(to)} ${money(amount)}`,
        };
      }
      return fallback;
    }
  }
}