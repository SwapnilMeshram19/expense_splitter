/**
 * Wire format shared with the server (supabase/migrations/*_sync_endpoints.sql):
 * snake_case, money in paise, timestamps as UTC epoch ms, calendar dates 'YYYY-MM-DD'.
 */
import type {
  ActivityLogEntry,
  Expense,
  Group,
  Member,
  Settlement,
} from '@/db/schema';

export type WireTable = 'groups' | 'members' | 'expenses' | 'settlements' | 'activity';
export type VersionedTable = Exclude<WireTable, 'activity'>;

export interface WireLine {
  member_id: string;
  amount_paise: number;
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
  expense_date: string;
  split_input: unknown;
  created_by_member_id: string;
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

/** Sent to the server: the server version this change was made on top of (0 = new). */
export type Outgoing<T> = T & { base_version: number };
/** Received from the server. */
export type Incoming<T> = T & { version: number };

export interface PushBatch {
  groups: Outgoing<WireGroup>[];
  members: Outgoing<WireMember>[];
  expenses: Outgoing<WireExpense>[];
  settlements: Outgoing<WireSettlement>[];
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
  activity: WireActivity[];
}

export function sortLines(lines: readonly WireLine[]): WireLine[] {
  return [...lines].sort((a, b) => (a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0));
}

export const toWireLines = (lines: readonly { memberId: string; amountPaise: number }[]): WireLine[] =>
  sortLines(lines.map((l) => ({ member_id: l.memberId, amount_paise: l.amountPaise })));

export const groupToWire = (g: Group): WireGroup => ({
  id: g.id,
  name: g.name,
  simplify_debts: g.simplifyDebts,
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
  payers: readonly { memberId: string; amountPaise: number }[],
  shares: readonly { memberId: string; amountPaise: number }[],
): WireExpense => ({
  id: e.id,
  group_id: e.groupId,
  description: e.description,
  amount_paise: e.amountPaise,
  category: e.category,
  expense_date: e.expenseDate,
  split_input: e.splitInput,
  created_by_member_id: e.createdByMemberId,
  created_at: e.createdAt,
  updated_at: e.updatedAt,
  deleted_at: e.deletedAt ?? null,
  payers: toWireLines(payers),
  shares: toWireLines(shares),
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

const SYNC_KEYS = new Set(['version', 'base_version']);

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

/** Same user-visible content, ignoring sync bookkeeping (version / base_version). */
export const sameContent = (a: object, b: object): boolean =>
  stableStringify(forComparison(a)) === stableStringify(forComparison(b));