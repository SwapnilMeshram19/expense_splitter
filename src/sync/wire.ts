/**
 * Wire format shared with the server (supabase/migrations/*_sync_endpoints.sql):
 * snake_case, money in minor units of the group currency (fields keep the `_paise` names),
 * timestamps as UTC epoch ms, calendar dates 'YYYY-MM-DD', exchange rates as decimal strings.
 */
import type {
  ActivityLogEntry,
  Expense,
  Group,
  Member,
  RecurringRule,
  Settlement,
} from '@/db/schema';

export type WireTable =
  | 'groups'
  | 'members'
  | 'expenses'
  | 'settlements'
  | 'recurring_rules'
  | 'activity';
export type VersionedTable = Exclude<WireTable, 'activity'>;

export interface WireLine {
  member_id: string;
  amount_paise: number;
  /** Payer lines of foreign bills only: the amount in the bill's currency. Omitted otherwise. */
  original_amount_minor?: number;
}

interface Lifecycle {
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface WireGroup extends Lifecycle {
  id: string;
  name: string;
  simplify_debts: boolean;
  /** ISO 4217. Absent from servers before multi-currency (= INR). */
  currency?: string;
}

export interface WireMember extends Lifecycle {
  id: string;
  group_id: string;
  display_name: string;
  user_id: string | null;
  upi_vpa: string | null;
}

export interface WireExpense extends Lifecycle {
  id: string;
  group_id: string;
  description: string;
  amount_paise: number;
  category: string;
  /** Custom category name (with category 'other'). Absent from servers before this migration. */
  category_label?: string | null;
  expense_date: string;
  split_input: unknown;
  created_by_member_id: string;
  /** Foreign bill (all three or none). Absent from servers before multi-currency. */
  original_currency?: string | null;
  original_amount_minor?: number | null;
  fx_rate?: string | null;
  /** Absent from servers before notes/receipts. */
  note?: string | null;
  /** Lowercase UUID naming the receipt photo in storage, or null. */
  receipt_id?: string | null;
  /** Occurrence of a recurring rule (both or neither). Absent from servers before recurring. */
  recurring_rule_id?: string | null;
  occurrence_date?: string | null;
  /**
   * Push only, never stored: the group currency this row's amounts are in. The server refuses the
   * row if the group's currency differs, and refuses rows WITHOUT it in non-INR groups (builds
   * from before multi-currency would read yen as paise).
   */
  group_currency?: string;
  payers: WireLine[];
  shares: WireLine[];
}

export interface WireSettlement extends Lifecycle {
  id: string;
  group_id: string;
  from_member_id: string;
  to_member_id: string;
  amount_paise: number;
  method: string;
  note: string | null;
  settled_at: number;
  created_by_member_id: string;
  /** Push only, never stored: see WireExpense.group_currency. */
  group_currency?: string;
}

export interface WireActivity {
  id: string;
  group_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_member_id: string | null;
  before: unknown;
  after: unknown;
  created_at: number;
}

export interface WireRecurringRule extends Lifecycle {
  id: string;
  group_id: string;
  description: string;
  amount_paise: number;
  category: string;
  category_label: string | null;
  note: string | null;
  split_input: unknown;
  payers: WireLine[];
  shares: WireLine[];
  frequency: string;
  start_date: string;
  end_date: string | null;
  time_zone: string;
  created_by_member_id: string;
  /** Push only, never stored: see WireExpense.group_currency. */
  group_currency?: string;
}

/** Sent to the server: the server version this change was made on top of (0 = new). */
export type Outgoing<T> = T & { base_version: number };
/** Received from the server. */
export type Incoming<T> = T & { version: number };

export interface PushBatch {
  groups: Outgoing<WireGroup>[];
  members: Outgoing<WireMember>[];
  expenses: Outgoing<WireExpense>[];
  settlements: Outgoing<WireSettlement>[];
  recurring_rules: Outgoing<WireRecurringRule>[];
  activity: WireActivity[];
}

export interface RowOutcome {
  table: WireTable;
  id: string;
  version?: number | null;
  server_version?: number;
  code?: string;
  detail?: string;
}

export interface PushResult {
  applied: RowOutcome[];
  conflicts: RowOutcome[];
  rejected: RowOutcome[];
}

export interface PullResult {
  cursor: string;
  group_ids: string[];
  groups: Incoming<WireGroup>[];
  members: Incoming<WireMember>[];
  expenses: Incoming<WireExpense>[];
  settlements: Incoming<WireSettlement>[];
  /** Absent from servers before recurring expenses. */
  recurring_rules?: Incoming<WireRecurringRule>[];
  activity: WireActivity[];
  more?: boolean;
}

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