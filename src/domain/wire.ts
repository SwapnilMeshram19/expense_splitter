/**
 * Wire format shared by the app, the web app and the server (Edge Functions + SQL):
 * snake_case, money in minor units of the group currency (fields keep the `_paise` names),
 * timestamps as UTC epoch ms, calendar dates 'YYYY-MM-DD', exchange rates as decimal strings.
 *
 * Types only, no imports: lives in domain so every client and the Edge Functions share one contract.
 */

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
  /** Budget in minor units of `currency` + 'total' | 'monthly' (both or neither). */
  budget_paise?: number | null;
  budget_period?: string | null;
}

export interface WireMember extends Lifecycle {
  id: string;
  group_id: string;
  display_name: string;
  user_id: string | null;
  upi_vpa: string | null;
  /** Payment details (JSON array). Absent from servers before this migration. */
  pay_methods?: unknown;
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
