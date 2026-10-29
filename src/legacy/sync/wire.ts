/**
 * Conversions between local rows and the wire format. The wire types live in src/domain/wire.ts
 * (shared with the server) and are re-exported here.
 */
import type {
  ActivityLogEntry,
  Expense,
  Group,
  Member,
  RecurringRule,
  Settlement,
} from '@/db/schema';
import { parsePayMethods } from '@/domain/payMethods';
import type {
  WireActivity,
  WireExpense,
  WireGroup,
  WireLine,
  WireMember,
  WireRecurringRule,
  WireSettlement,
} from '@/domain/wire';

export type {
  Incoming,
  Outgoing,
  PullResult,
  PushBatch,
  PushResult,
  RowOutcome,
  VersionedTable,
  WireActivity,
  WireExpense,
  WireGroup,
  WireLine,
  WireMember,
  WireRecurringRule,
  WireSettlement,
  WireTable,
} from '@/domain/wire';

export function sortLines(lines: readonly WireLine[]): WireLine[] {
  return [...lines].sort((a, b) => (a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0));
}

interface LocalLine {
  memberId: string;
  amountPaise: number;
  originalAmountMinor?: number | null;
}

export const toWireLines = (lines: readonly LocalLine[]): WireLine[] =>
  sortLines(
    lines.map((l) =>
      typeof l.originalAmountMinor === 'number'
        ? {
            member_id: l.memberId,
            amount_paise: l.amountPaise,
            original_amount_minor: l.originalAmountMinor,
          }
        : { member_id: l.memberId, amount_paise: l.amountPaise },
    ),
  );

export const groupToWire = (g: Group): WireGroup => ({
  id: g.id,
  name: g.name,
  simplify_debts: g.simplifyDebts,
  currency: g.currency,
  budget_paise: g.budgetPaise ?? null,
  budget_period: g.budgetPeriod ?? null,
  created_at: g.createdAt,
  updated_at: g.updatedAt,
  deleted_at: g.deletedAt ?? null,
});

export const memberToWire = (m: Member): WireMember => ({
  id: m.id,
  group_id: m.groupId,
  display_name: m.displayName,
  user_id: m.userId ?? null,
  upi_vpa: m.upiVpa ?? null,
  // The server refuses an empty array: none = null.
  pay_methods: parsePayMethods(m.payMethods).length > 0 ? parsePayMethods(m.payMethods) : null,
  created_at: m.createdAt,
  updated_at: m.updatedAt,
  deleted_at: m.deletedAt ?? null,
});

export const expenseToWire = (
  e: Expense,
  payers: readonly LocalLine[],
  shares: readonly LocalLine[],
): WireExpense => ({
  id: e.id,
  group_id: e.groupId,
  description: e.description,
  amount_paise: e.amountPaise,
  category: e.category,
  category_label: e.categoryLabel ?? null,
  expense_date: e.expenseDate,
  split_input: e.splitInput,
  created_by_member_id: e.createdByMemberId,
  original_currency: e.originalCurrency ?? null,
  original_amount_minor: e.originalAmountMinor ?? null,
  fx_rate: e.fxRate ?? null,
  note: e.note ?? null,
  receipt_id: e.receiptId ?? null,
  recurring_rule_id: e.recurringRuleId ?? null,
  occurrence_date: e.occurrenceDate ?? null,
  created_at: e.createdAt,
  updated_at: e.updatedAt,
  deleted_at: e.deletedAt ?? null,
  payers: toWireLines(payers),
  // Shares never carry original amounts: they are recomputed from split_input.
  shares: toWireLines(shares.map((l) => ({ memberId: l.memberId, amountPaise: l.amountPaise }))),
});

export const ruleToWire = (r: RecurringRule): WireRecurringRule => ({
  id: r.id,
  group_id: r.groupId,
  description: r.description,
  amount_paise: r.amountPaise,
  category: r.category,
  category_label: r.categoryLabel ?? null,
  note: r.note ?? null,
  split_input: r.splitInput,
  payers: toWireLines(r.payers),
  shares: toWireLines(r.shares),
  frequency: r.frequency,
  start_date: r.startDate,
  end_date: r.endDate ?? null,
  time_zone: r.timeZone,
  created_by_member_id: r.createdByMemberId,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
  deleted_at: r.deletedAt ?? null,
});

export const settlementToWire = (s: Settlement): WireSettlement => ({
  id: s.id,
  group_id: s.groupId,
  from_member_id: s.fromMemberId,
  to_member_id: s.toMemberId,
  amount_paise: s.amountPaise,
  method: s.method,
  note: s.note ?? null,
  settled_at: s.settledAt,
  created_by_member_id: s.createdByMemberId,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
  deleted_at: s.deletedAt ?? null,
});

export const activityToWire = (a: ActivityLogEntry): WireActivity => ({
  id: a.id,
  group_id: a.groupId,
  entity_type: a.entityType,
  entity_id: a.entityId,
  action: a.action,
  actor_member_id: a.actorMemberId ?? null,
  before: a.before ?? null,
  after: a.after ?? null,
  created_at: a.createdAt,
});

/** JSON with sorted keys: Postgres jsonb does not preserve key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Sync bookkeeping and push-only assertions: never part of the content. */
const SYNC_KEYS = new Set(['version', 'base_version', 'group_currency']);

function forComparison(row: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (SYNC_KEYS.has(key)) continue;
    out[key] =
      (key === 'payers' || key === 'shares') && Array.isArray(value)
        ? sortLines(value as WireLine[])
        : value;
  }
  return out;
}

/** Same user-visible content, ignoring sync bookkeeping (version / base_version / group_currency). */
export const sameContent = (a: object, b: object): boolean =>
  stableStringify(forComparison(a)) === stableStringify(forComparison(b));