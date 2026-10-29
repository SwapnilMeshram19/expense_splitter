/**
 * Every change a person can make, as a command. One planner, run in two places:
 * - on the server (Edge Function `api`), against the group as stored: the authority;
 * - on the phone / in the browser, against the cached group: instant validation and display.
 *
 * planCommand() validates the input against the group and returns the rows to store (wire format,
 * with the version each change was made on) plus the history entries. It never touches a
 * database, so both sides make exactly the same decision, rounding included.
 *
 * Pure TypeScript, same-folder imports only: copied into the Edge Functions by sync-domain.mjs.
 */
import { computeBalances, type PayerLine } from './balances';
import { isBudgetPeriod, parseBudget, type Budget } from './budget';
import { normalizeCategoryLabel } from './categoryLabel';
import { DEFAULT_CURRENCY, isSupportedCurrency, maxAmountMinor, type CurrencyCode } from './currency';
import { validateExpense, type ExpenseValidationError } from './expenseValidation';
import type { ForeignAmount } from './fx';
import {
  activeMemberIdSet,
  activeMembers,
  activityFromWire,
  byMemberId,
  compareExpensesNewestFirst,
  expenseFromWire,
  groupFromWire,
  isExpenseCategory,
  isSettlementMethod,
  ledgerOf,
  memberFromWire,
  ruleFromWire,
  selfMember,
  settlementFromWire,
  type ActivityEntry,
  type Expense,
  type ExpenseCategory,
  type Group,
  type GroupSnapshot,
  type Member,
  type RecurringRule,
  type RuleLine,
  type Settlement,
  type SettlementMethod,
  type StoredSplitInput,
} from './model';
import { findDuplicateName, normalizeName, validateName, type NameError } from './names';
import { isReceiptId, normalizeNote } from './note';
import { MAX_PAY_METHODS, methodKinds, parsePayMethods, samePayMethod, serializePayMethods, type PayMethod } from './payMethods';
import { validateSchedule, type Frequency, type ScheduleError } from './recurrence';
import type { ShareLine } from './splits';
import { maskVpa, parseVpaInput, type VpaError } from './upi';
import type {
  Outgoing,
  PushBatch,
  WireActivity,
  WireExpense,
  WireGroup,
  WireLine,
  WireMember,
  WireRecurringRule,
  WireSettlement,
} from './wire';

// ── Inputs ─────────────────────────────────────────────────────────────

export interface ExpenseFields {
  description: string;
  /** Total in the group currency (for a foreign bill: the converted total, checked here). */
  amountPaise: number;
  category?: ExpenseCategory;
  /** Custom category name, with category 'other'. Undefined on update keeps the stored one. */
  categoryLabel?: string | null;
  expenseDate: string;
  /** In the bill's currency when `foreign` is set, else in the group currency. */
  payers: PayerLine[];
  /** In the bill's currency when `foreign` is set, else in the group currency. */
  splitInput: StoredSplitInput;
  foreign?: ForeignAmount | null;
  /** Undefined on update keeps the stored note. */
  note?: string | null;
  /** Undefined on update keeps the stored receipt. */
  receiptId?: string | null;
}

export interface RuleFields {
  description: string;
  amountPaise: number;
  category?: ExpenseCategory;
  categoryLabel?: string | null;
  note?: string | null;
  payers: PayerLine[];
  splitInput: StoredSplitInput;
  frequency: Frequency;
  startDate: string;
  endDate: string | null;
  /** IANA zone of the device, used by the server's job to pick the calendar day. */
  timeZone: string;
}

export interface CommandInputs {
  'group.create': {
    id: string;
    name: string;
    myMemberId: string;
    myName: string;
    /** Other people to add as placeholders (ids made by the client). */
    members?: { id: string; name: string }[];
    currency?: CurrencyCode;
    /** Your saved payment details, copied onto your member row. */
    myUpiVpa?: string | null;
    myPayMethods?: PayMethod[];
  };
  'group.update': {
    groupId: string;
    expectedVersion: number;
    name?: string;
    simplifyDebts?: boolean;
    currency?: CurrencyCode;
    /** null removes the budget. */
    budget?: Budget | null;
  };
  'group.delete': { groupId: string; expectedVersion: number };
  'member.add': { groupId: string; id: string; displayName: string };
  'member.update': {
    groupId: string;
    memberId: string;
    expectedVersion: number;
    displayName?: string;
    /** As typed (or a pasted upi:// link); null or blank clears it. */
    upiVpa?: string | null;
    payMethods?: PayMethod[];
  };
  'member.remove': { groupId: string; memberId: string; expectedVersion: number };
  'expense.add': ExpenseFields & { groupId: string; id: string };
  'expense.update': ExpenseFields & { groupId: string; expenseId: string; expectedVersion: number };
  'expense.delete': { groupId: string; expenseId: string; expectedVersion: number };
  'settlement.add': {
    groupId: string;
    id: string;
    fromMemberId: string;
    toMemberId: string;
    amountPaise: number;
    method: SettlementMethod;
    note?: string | null;
    /** When the payment happened (epoch ms). Defaults to now; a queued payment keeps its time. */
    settledAt?: number;
  };
  'settlement.delete': { groupId: string; settlementId: string; expectedVersion: number };
  'recurring.create': RuleFields & { groupId: string; id: string };
  'recurring.update': RuleFields & { groupId: string; ruleId: string; expectedVersion: number };
  'recurring.delete': { groupId: string; ruleId: string; expectedVersion: number };
}

export type CommandOp = keyof CommandInputs;
export type Command = { [K in CommandOp]: { op: K; input: CommandInputs[K] } }[CommandOp];
export const COMMAND_OPS = [
  'group.create',
  'group.update',
  'group.delete',
  'member.add',
  'member.update',
  'member.remove',
  'expense.add',
  'expense.update',
  'expense.delete',
  'settlement.add',
  'settlement.delete',
  'recurring.create',
  'recurring.update',
  'recurring.delete',
] as const satisfies readonly CommandOp[];
export const isCommandOp = (v: unknown): v is CommandOp =>
  typeof v === 'string' && (COMMAND_OPS as readonly string[]).includes(v);

/** Ops that may wait in a phone's offline queue: they only add rows, so a late send can't clash. */
export const QUEUEABLE_OPS = ['expense.add', 'settlement.add', 'group.create'] as const satisfies readonly CommandOp[];
export const isQueueable = (op: CommandOp): boolean => (QUEUEABLE_OPS as readonly string[]).includes(op);

// ── Errors ─────────────────────────────────────────────────────────────

/** The caller isn't an active member, the row is gone, or someone changed it first. */
export type CommonError =
  | { code: 'NOT_A_MEMBER' }
  | { code: 'NOT_FOUND' }
  | { code: 'STALE' }
  | { code: 'ID_TAKEN' }
  | { code: 'INVALID_INPUT' };

export type GroupCreateError =
  | { code: 'INVALID_GROUP_NAME'; error: NameError }
  | { code: 'INVALID_MEMBER_NAME'; error: NameError }
  | { code: 'UNKNOWN_CURRENCY' }
  | PayDetailsError;
export type GroupUpdateError =
  | NameError
  | { code: 'UNKNOWN_CURRENCY' }
  | { code: 'CURRENCY_LOCKED' }
  | { code: 'INVALID_BUDGET'; max: number };
export type GroupDeleteError = { code: 'UNSETTLED_BALANCES'; count: number };
export type PayDetailsError = VpaError | { code: 'NOT_ALLOWED' } | { code: 'TOO_MANY_METHODS'; max: number } | { code: 'INVALID_PAY_METHOD' };
export type MemberError =
  | NameError
  | PayDetailsError
  | { code: 'CANNOT_REMOVE_SELF' }
  | { code: 'MEMBER_HAS_BALANCE'; balancePaise: number };
export type ExpenseError =
  | ExpenseValidationError
  | { code: 'CATEGORY_LABEL_TOO_LONG' }
  | { code: 'NOTE_TOO_LONG' }
  | { code: 'INVALID_RECEIPT' }
  | { code: 'INVALID_CATEGORY' };
export type SettlementError =
  | { code: 'INVALID_AMOUNT' }
  | { code: 'SAME_PERSON' }
  | { code: 'UNKNOWN_MEMBER'; memberId: string }
  | { code: 'NOTE_TOO_LONG'; max: number }
  | { code: 'INVALID_METHOD' }
  | { code: 'INVALID_TIME' };
export type RuleError =
  | ExpenseValidationError
  | { code: 'CATEGORY_LABEL_TOO_LONG' }
  | { code: 'NOTE_TOO_LONG' }
  | { code: 'INVALID_CATEGORY' }
  | { code: 'SCHEDULE'; error: ScheduleError }
  | { code: 'SCHEDULE_LOCKED' }
  | { code: 'INVALID_TIME_ZONE' };

export interface CommandErrors {
  'group.create': GroupCreateError;
  'group.update': GroupUpdateError;
  'group.delete': GroupDeleteError;
  'member.add': MemberError;
  'member.update': MemberError;
  'member.remove': MemberError;
  'expense.add': ExpenseError;
  'expense.update': ExpenseError;
  'expense.delete': never;
  'settlement.add': SettlementError;
  'settlement.delete': never;
  'recurring.create': RuleError;
  'recurring.update': RuleError;
  'recurring.delete': never;
}

/** What a command can fail with: its own validation errors, or a common one. */
export type CommandError<K extends CommandOp = CommandOp> = CommandErrors[K] | CommonError;

// ── Plan ───────────────────────────────────────────────────────────────

export interface Plan {
  groupId: string;
  /** The row the command is about (the new expense, the renamed member…). */
  entityId: string;
  /** Rows to store, each with the version it was made on (0 = new). Empty = nothing changed. */
  batch: PushBatch;
  /** recurring.create / .update: create the rule's due expenses right away. */
  generateRuleId?: string;
}

export interface PlanContext {
  /** The signed-in (or anonymous) user. */
  userId: string;
  /** Epoch ms used for created/updated times and history entries. */
  now: number;
  /** New ids for history entries. */
  newId: () => string;
}

export type PlanResult<K extends CommandOp = CommandOp> = { ok: true; plan: Plan } | { ok: false; error: CommandError<K> };

const fail = <K extends CommandOp>(error: CommandError<K>): PlanResult<K> => ({ ok: false, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const MAX_SETTLEMENT_NOTE_LENGTH = 100;
const TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/;
const MAX_FUTURE_MS = 5 * 60_000;

const emptyBatch = (): PushBatch => ({
  groups: [],
  members: [],
  expenses: [],
  settlements: [],
  recurring_rules: [],
  activity: [],
});

/** Group the command is for (every command names it; group.create names the new one). */
export const commandGroupId = (cmd: Command): string =>
  (cmd.op === 'group.create' ? cmd.input.id : cmd.input.groupId).toLowerCase();

// ── Model → wire ───────────────────────────────────────────────────────

const toLines = (lines: readonly { memberId: string; amountPaise: number; originalAmountMinor?: number | null }[]): WireLine[] =>
  [...lines].sort(byMemberId).map((l) =>
    typeof l.originalAmountMinor === 'number'
      ? { member_id: l.memberId, amount_paise: l.amountPaise, original_amount_minor: l.originalAmountMinor }
      : { member_id: l.memberId, amount_paise: l.amountPaise },
  );

const groupWire = (g: Group, base: number): Outgoing<WireGroup> => ({
  id: g.id,
  name: g.name,
  simplify_debts: g.simplifyDebts,
  currency: g.currency,
  budget_paise: g.budgetPaise,
  budget_period: g.budgetPeriod,
  created_at: g.createdAt,
  updated_at: g.updatedAt,
  deleted_at: g.deletedAt,
  base_version: base,
});

const memberWire = (m: Member, base: number): Outgoing<WireMember> => {
  const methods = parsePayMethods(m.payMethods);
  return {
    id: m.id,
    group_id: m.groupId,
    display_name: m.displayName,
    user_id: m.userId,
    upi_vpa: m.upiVpa,
    // The server refuses an empty array: none = null.
    pay_methods: methods.length > 0 ? methods : null,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    deleted_at: m.deletedAt,
    base_version: base,
  };
};

const expenseWire = (e: Expense, base: number, currency: string): Outgoing<WireExpense> => ({
  id: e.id,
  group_id: e.groupId,
  description: e.description,
  amount_paise: e.amountPaise,
  category: e.category,
  category_label: e.categoryLabel,
  expense_date: e.expenseDate,
  split_input: e.splitInput,
  created_by_member_id: e.createdByMemberId,
  original_currency: e.originalCurrency,
  original_amount_minor: e.originalAmountMinor,
  fx_rate: e.fxRate,
  note: e.note,
  receipt_id: e.receiptId,
  recurring_rule_id: e.recurringRuleId,
  occurrence_date: e.occurrenceDate,
  created_at: e.createdAt,
  updated_at: e.updatedAt,
  deleted_at: e.deletedAt,
  group_currency: currency,
  payers: toLines(e.payers),
  shares: toLines(e.shares.map((s) => ({ memberId: s.memberId, amountPaise: s.amountPaise }))),
  base_version: base,
});

const settlementWire = (s: Settlement, base: number, currency: string): Outgoing<WireSettlement> => ({
  id: s.id,
  group_id: s.groupId,
  from_member_id: s.fromMemberId,
  to_member_id: s.toMemberId,
  amount_paise: s.amountPaise,
  method: s.method,
  note: s.note,
  settled_at: s.settledAt,
  created_by_member_id: s.createdByMemberId,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
  deleted_at: s.deletedAt,
  group_currency: currency,
  base_version: base,
});

const ruleWire = (r: RecurringRule, base: number, currency: string): Outgoing<WireRecurringRule> => ({
  id: r.id,
  group_id: r.groupId,
  description: r.description,
  amount_paise: r.amountPaise,
  category: r.category,
  category_label: r.categoryLabel,
  note: r.note,
  split_input: r.splitInput,
  payers: toLines(r.payers),
  shares: toLines(r.shares),
  frequency: r.frequency,
  start_date: r.startDate,
  end_date: r.endDate,
  time_zone: r.timeZone,
  created_by_member_id: r.createdByMemberId,
  created_at: r.createdAt,
  updated_at: r.updatedAt,
  deleted_at: r.deletedAt,
  group_currency: currency,
  base_version: base,
});

function activity(
  ctx: PlanContext,
  groupId: string,
  entityType: ActivityEntry['entityType'],
  entityId: string,
  action: ActivityEntry['action'],
  actorMemberId: string | null,
  before: unknown,
  after: unknown,
): WireActivity {
  return {
    id: ctx.newId(),
    group_id: groupId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor_member_id: actorMemberId,
    before: before ?? null,
    after: after ?? null,
    created_at: ctx.now,
  };
}

// ── History snapshots (the shapes describeActivity reads) ─────────────

type ExpenseSnapshotSource = Pick<
  Expense,
  | 'description'
  | 'amountPaise'
  | 'category'
  | 'categoryLabel'
  | 'expenseDate'
  | 'splitInput'
  | 'originalCurrency'
  | 'originalAmountMinor'
  | 'fxRate'
  | 'note'
  | 'receiptId'
>;

const plainLines = (lines: readonly { memberId: string; amountPaise: number }[]) =>
  lines.map((l) => ({ memberId: l.memberId, amountPaise: l.amountPaise }));

function expenseSnapshot(e: ExpenseSnapshotSource, payers: readonly PayerLine[], shares: readonly ShareLine[]) {
  const foreign =
    e.originalCurrency && e.originalAmountMinor !== null && e.fxRate
      ? { currency: e.originalCurrency, amountMinor: e.originalAmountMinor, rate: e.fxRate }
      : null;
  return {
    description: e.description,
    amountPaise: e.amountPaise,
    category: e.category,
    categoryLabel: e.categoryLabel,
    expenseDate: e.expenseDate,
    splitInput: e.splitInput,
    // Only when set, so history entries without them keep their old shape.
    ...(foreign ? { foreign } : {}),
    ...(e.note ? { note: e.note } : {}),
    ...(e.receiptId ? { receiptId: e.receiptId } : {}),
    payers: plainLines(payers),
    shares: plainLines(shares),
  };
}

const settlementSnapshot = (s: Pick<Settlement, 'fromMemberId' | 'toMemberId' | 'amountPaise' | 'method' | 'note' | 'settledAt'>) => ({
  fromMemberId: s.fromMemberId,
  toMemberId: s.toMemberId,
  amountPaise: s.amountPaise,
  method: s.method,
  note: s.note,
  settledAt: s.settledAt,
});

// ── Shared checks ──────────────────────────────────────────────────────

/** The caller's member, or an error when they can't change this group. */
function actorIn(state: GroupSnapshot | null, ctx: PlanContext): Member | CommonError {
  if (!state || state.group.deletedAt !== null) return { code: 'NOT_FOUND' };
  const me = selfMember(state, ctx.userId);
  return me ?? { code: 'NOT_A_MEMBER' };
}
const isErr = (v: object): v is CommonError => 'code' in v;

/** The label to store: only with 'other'. `requested` undefined = keep `current`; null or '' = plain Other. */
export function resolveCategoryLabel(
  category: ExpenseCategory,
  requested: string | null | undefined,
  current: string | null,
): { ok: true; label: string | null } | { ok: false } {
  if (category !== 'other') return { ok: true, label: null };
  if (requested === undefined) return { ok: true, label: current };
  const normalized = normalizeCategoryLabel(requested);
  return normalized.ok ? { ok: true, label: normalized.label } : { ok: false };
}

function dedupeMethods(methods: readonly PayMethod[]): { ok: true; methods: PayMethod[] } | { ok: false; error: PayDetailsError } {
  if (!Array.isArray(methods)) return { ok: false, error: { code: 'INVALID_PAY_METHOD' } };
  const out: PayMethod[] = [];
  for (const m of methods) if (!out.some((x) => samePayMethod(x, m))) out.push(m);
  if (out.length > MAX_PAY_METHODS) return { ok: false, error: { code: 'TOO_MANY_METHODS', max: MAX_PAY_METHODS } };
  // Untrusted input: keep it only if every entry passes the same checks as stored data.
  const valid = parsePayMethods(out);
  if (valid.length !== out.length) return { ok: false, error: { code: 'INVALID_PAY_METHOD' } };
  return { ok: true, methods: valid };
}

function parseVpa(input: string | null | undefined): { ok: true; vpa: string | null } | { ok: false; error: VpaError } {
  if (input === null || input === undefined || input.trim() === '') return { ok: true, vpa: null };
  const parsed = parseVpaInput(input);
  return parsed.ok ? { ok: true, vpa: parsed.vpa } : { ok: false, error: parsed.error };
}

const balanceOf = (state: GroupSnapshot, memberId: string): number => {
  const ledger = ledgerOf(state);
  return computeBalances(ledger.expenses, ledger.settlements).balances.get(memberId) ?? 0;
};

// ── Planners ───────────────────────────────────────────────────────────

function planGroupCreate(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['group.create']): PlanResult<'group.create'> {
  if (state) return fail({ code: 'ID_TAKEN' });
  const ids = [input.id, input.myMemberId, ...(input.members ?? []).map((m) => m.id)];
  if (!ids.every(isUuid) || new Set(ids.map((i) => i.toLowerCase())).size !== ids.length) return fail({ code: 'ID_TAKEN' });

  const name = normalizeName(input.name);
  const groupNameError = validateName(name);
  if (groupNameError) return fail({ code: 'INVALID_GROUP_NAME', error: groupNameError });

  const others = (input.members ?? []).map((m) => ({ id: m.id.toLowerCase(), name: normalizeName(m.name) }));
  const names = [normalizeName(input.myName), ...others.map((m) => m.name)];
  for (const n of names) {
    const e = validateName(n);
    if (e) return fail({ code: 'INVALID_MEMBER_NAME', error: e });
  }
  const duplicate = findDuplicateName(names);
  if (duplicate) return fail({ code: 'INVALID_MEMBER_NAME', error: { code: 'DUPLICATE_NAME', name: duplicate } });

  const currency = input.currency ?? DEFAULT_CURRENCY;
  if (!isSupportedCurrency(currency)) return fail({ code: 'UNKNOWN_CURRENCY' });

  const vpa = parseVpa(input.myUpiVpa);
  if (!vpa.ok) return fail(vpa.error);
  const methods = dedupeMethods(input.myPayMethods ?? []);
  if (!methods.ok) return fail(methods.error);

  const t = ctx.now;
  const groupId = input.id.toLowerCase();
  const myId = input.myMemberId.toLowerCase();
  const life = { createdAt: t, updatedAt: t, deletedAt: null, version: 0 };
  const group: Group = { id: groupId, name, simplifyDebts: true, currency, budgetPaise: null, budgetPeriod: null, ...life };
  const memberRows: Member[] = [
    {
      id: myId,
      groupId,
      displayName: names[0]!,
      userId: ctx.userId,
      upiVpa: vpa.vpa,
      payMethods: serializePayMethods(methods.methods),
      ...life,
    },
    ...others.map((m) => ({ id: m.id, groupId, displayName: m.name, userId: null, upiVpa: null, payMethods: null, ...life })),
  ];

  const batch = emptyBatch();
  batch.groups.push(groupWire(group, 0));
  batch.members.push(...memberRows.map((m) => memberWire(m, 0)));
  batch.activity.push(activity(ctx, groupId, 'group', groupId, 'create', myId, null, { name, members: names, currency }));
  return { ok: true, plan: { groupId, entityId: groupId, batch } };
}

function planGroupUpdate(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['group.update']): PlanResult<'group.update'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  if (s.group.version !== input.expectedVersion) return fail({ code: 'STALE' });

  const g = s.group;
  const next: Group = { ...g };
  const log: WireActivity[] = [];
  const entry = (before: unknown, after: unknown) =>
    log.push(activity(ctx, g.id, 'group', g.id, 'update', me.id, before, after));

  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    const e = validateName(name);
    if (e) return fail(e);
    if (name !== g.name) {
      next.name = name;
      entry({ name: g.name }, { name });
    }
  }
  if (input.simplifyDebts !== undefined && input.simplifyDebts !== g.simplifyDebts) {
    next.simplifyDebts = input.simplifyDebts;
    entry({ simplifyDebts: g.simplifyDebts }, { simplifyDebts: input.simplifyDebts });
  }
  if (input.currency !== undefined && input.currency !== g.currency) {
    if (!isSupportedCurrency(input.currency)) return fail({ code: 'UNKNOWN_CURRENCY' });
    if (s.currencyLocked) return fail({ code: 'CURRENCY_LOCKED' });
    // A budget is an amount in the old currency: it doesn't carry over.
    next.currency = input.currency;
    next.budgetPaise = null;
    next.budgetPeriod = null;
    entry({ currency: g.currency }, { currency: input.currency });
  }
  if (input.budget !== undefined) {
    const budget = input.budget;
    const max = maxAmountMinor(next.currency);
    if (
      budget &&
      (!Number.isSafeInteger(budget.limit) || budget.limit <= 0 || budget.limit > max || !isBudgetPeriod(budget.period))
    ) {
      return fail({ code: 'INVALID_BUDGET', max });
    }
    const before = parseBudget(next.budgetPaise, next.budgetPeriod);
    if (before?.limit !== budget?.limit || before?.period !== budget?.period) {
      next.budgetPaise = budget?.limit ?? null;
      next.budgetPeriod = budget?.period ?? null;
      entry({ budget: parseBudget(g.budgetPaise, g.budgetPeriod) }, { budget });
    }
  }

  const batch = emptyBatch();
  if (log.length > 0) {
    next.updatedAt = ctx.now;
    batch.groups.push(groupWire(next, input.expectedVersion));
    batch.activity.push(...log);
  }
  return { ok: true, plan: { groupId: g.id, entityId: g.id, batch } };
}

function planGroupDelete(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['group.delete']): PlanResult<'group.delete'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  if (s.group.version !== input.expectedVersion) return fail({ code: 'STALE' });
  const ledger = ledgerOf(s);
  const unsettled = [...computeBalances(ledger.expenses, ledger.settlements).balances.values()].filter((b) => b !== 0).length;
  if (unsettled > 0) return fail({ code: 'UNSETTLED_BALANCES', count: unsettled });

  const batch = emptyBatch();
  batch.groups.push(groupWire({ ...s.group, deletedAt: ctx.now, updatedAt: ctx.now }, input.expectedVersion));
  batch.activity.push(activity(ctx, s.group.id, 'group', s.group.id, 'delete', me.id, { name: s.group.name }, null));
  return { ok: true, plan: { groupId: s.group.id, entityId: s.group.id, batch } };
}

function planMemberAdd(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['member.add']): PlanResult<'member.add'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const id = input.id.toLowerCase();
  if (!isUuid(id) || s.members.some((m) => m.id === id)) return fail({ code: 'ID_TAKEN' });

  const displayName = normalizeName(input.displayName);
  const e = validateName(displayName);
  if (e) return fail(e);
  if (findDuplicateName([...activeMembers(s).map((m) => m.displayName), displayName])) {
    return fail({ code: 'DUPLICATE_NAME', name: displayName });
  }

  const t = ctx.now;
  const member: Member = {
    id,
    groupId: s.group.id,
    displayName,
    userId: null,
    upiVpa: null,
    payMethods: null,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    version: 0,
  };
  const batch = emptyBatch();
  batch.members.push(memberWire(member, 0));
  batch.activity.push(activity(ctx, s.group.id, 'member', id, 'create', me.id, null, { displayName }));
  return { ok: true, plan: { groupId: s.group.id, entityId: id, batch } };
}

/** A claimed member's payment details are theirs alone; a placeholder's can be set by anyone. */
export const canEditPayDetails = (member: { id: string; userId: string | null }, actorMemberId: string): boolean =>
  member.id === actorMemberId || member.userId === null;

function planMemberUpdate(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['member.update']): PlanResult<'member.update'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const member = s.members.find((m) => m.id === input.memberId.toLowerCase() && m.deletedAt === null);
  if (!member) return fail({ code: 'NOT_FOUND' });
  if (member.version !== input.expectedVersion) return fail({ code: 'STALE' });

  const next: Member = { ...member };
  const log: WireActivity[] = [];
  const entry = (before: unknown, after: unknown) =>
    log.push(activity(ctx, s.group.id, 'member', member.id, 'update', me.id, before, after));

  if (input.displayName !== undefined) {
    const displayName = normalizeName(input.displayName);
    const e = validateName(displayName);
    if (e) return fail(e);
    if (displayName !== member.displayName) {
      const others = activeMembers(s).filter((m) => m.id !== member.id).map((m) => m.displayName);
      if (findDuplicateName([...others, displayName])) return fail({ code: 'DUPLICATE_NAME', name: displayName });
      next.displayName = displayName;
      entry({ displayName: member.displayName }, { displayName });
    }
  }
  if (input.upiVpa !== undefined || input.payMethods !== undefined) {
    if (!canEditPayDetails(member, me.id)) return fail({ code: 'NOT_ALLOWED' });
  }
  if (input.upiVpa !== undefined) {
    const vpa = parseVpa(input.upiVpa);
    if (!vpa.ok) return fail(vpa.error);
    if (vpa.vpa !== member.upiVpa) {
      next.upiVpa = vpa.vpa;
      // Masked: the log is append-only; full IDs (often phone numbers) must not live there forever.
      entry({ upiVpa: member.upiVpa ? maskVpa(member.upiVpa) : null }, { upiVpa: vpa.vpa ? maskVpa(vpa.vpa) : null });
    }
  }
  if (input.payMethods !== undefined) {
    const methods = dedupeMethods(input.payMethods);
    if (!methods.ok) return fail(methods.error);
    const before = parsePayMethods(member.payMethods);
    const serialized = serializePayMethods(methods.methods);
    if (serialized !== serializePayMethods(before)) {
      next.payMethods = serialized;
      // Kinds only: account details must not live in the history.
      entry({ payMethods: methodKinds(before) }, { payMethods: methodKinds(methods.methods) });
    }
  }

  const batch = emptyBatch();
  if (log.length > 0) {
    next.updatedAt = ctx.now;
    batch.members.push(memberWire(next, input.expectedVersion));
    batch.activity.push(...log);
  }
  return { ok: true, plan: { groupId: s.group.id, entityId: member.id, batch } };
}

function planMemberRemove(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['member.remove']): PlanResult<'member.remove'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const member = s.members.find((m) => m.id === input.memberId.toLowerCase() && m.deletedAt === null);
  if (!member) return fail({ code: 'NOT_FOUND' });
  if (member.version !== input.expectedVersion) return fail({ code: 'STALE' });
  if (member.id === me.id) return fail({ code: 'CANNOT_REMOVE_SELF' });
  const balance = balanceOf(s, member.id);
  if (balance !== 0) return fail({ code: 'MEMBER_HAS_BALANCE', balancePaise: balance });

  const batch = emptyBatch();
  batch.members.push(memberWire({ ...member, deletedAt: ctx.now, updatedAt: ctx.now }, input.expectedVersion));
  batch.activity.push(activity(ctx, s.group.id, 'member', member.id, 'delete', me.id, { displayName: member.displayName }, null));
  return { ok: true, plan: { groupId: s.group.id, entityId: member.id, batch } };
}

/** Validate expense fields; the stored note/receipt/label are kept where the input leaves them undefined. */
function checkExpense(
  s: GroupSnapshot,
  fields: ExpenseFields,
  allowed: Set<string>,
  current: Pick<Expense, 'note' | 'receiptId' | 'categoryLabel'> | null,
) {
  if (fields.category !== undefined && !isExpenseCategory(fields.category)) return { ok: false as const, error: { code: 'INVALID_CATEGORY' } as ExpenseError };
  const valid = validateExpense({ ...fields, currency: s.group.currency }, allowed);
  if (!valid.ok) return { ok: false as const, error: valid.error as ExpenseError };

  const category = fields.category ?? 'general';
  const label = resolveCategoryLabel(category, fields.categoryLabel, current?.categoryLabel ?? null);
  if (!label.ok) return { ok: false as const, error: { code: 'CATEGORY_LABEL_TOO_LONG' } as ExpenseError };

  let note = current?.note ?? null;
  if (fields.note !== undefined) {
    const parsed = normalizeNote(fields.note);
    if (!parsed.ok) return { ok: false as const, error: { code: 'NOTE_TOO_LONG' } as ExpenseError };
    note = parsed.note;
  }
  const receiptId = fields.receiptId === undefined ? (current?.receiptId ?? null) : fields.receiptId;
  if (receiptId !== null && !isReceiptId(receiptId)) return { ok: false as const, error: { code: 'INVALID_RECEIPT' } as ExpenseError };

  const original = new Map(valid.originalPayers?.map((p) => [p.memberId, p.amountPaise]));
  return {
    ok: true as const,
    row: {
      description: valid.description,
      amountPaise: fields.amountPaise,
      category,
      categoryLabel: label.label,
      expenseDate: fields.expenseDate,
      splitInput: fields.splitInput,
      originalCurrency: fields.foreign?.currency ?? null,
      originalAmountMinor: fields.foreign?.amountMinor ?? null,
      fxRate: fields.foreign?.rate ?? null,
      note,
      receiptId,
    },
    payers: valid.payers
      .map((p) => ({ memberId: p.memberId, amountPaise: p.amountPaise, originalAmountMinor: original.get(p.memberId) ?? null }))
      .sort(byMemberId),
    shares: [...valid.shares].sort(byMemberId),
  };
}

function planExpenseAdd(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['expense.add']): PlanResult<'expense.add'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const id = input.id.toLowerCase();
  if (!isUuid(id) || s.expenses.some((e) => e.id === id)) return fail({ code: 'ID_TAKEN' });

  const checked = checkExpense(s, input, activeMemberIdSet(s), null);
  if (!checked.ok) return fail(checked.error);
  const t = ctx.now;
  const expense: Expense = {
    id,
    groupId: s.group.id,
    ...checked.row,
    recurringRuleId: null,
    occurrenceDate: null,
    createdByMemberId: me.id,
    payers: checked.payers,
    shares: checked.shares,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    version: 0,
  };
  const batch = emptyBatch();
  batch.expenses.push(expenseWire(expense, 0, s.group.currency));
  batch.activity.push(
    activity(ctx, s.group.id, 'expense', id, 'create', me.id, null, expenseSnapshot(expense, checked.payers, checked.shares)),
  );
  return { ok: true, plan: { groupId: s.group.id, entityId: id, batch } };
}

function planExpenseUpdate(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['expense.update']): PlanResult<'expense.update'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const existing = s.expenses.find((e) => e.id === input.expenseId.toLowerCase());
  if (!existing) return fail({ code: 'NOT_FOUND' });
  if (existing.version !== input.expectedVersion) return fail({ code: 'STALE' });

  // Members who have since left may stay on an expense they were already part of.
  const allowed = activeMemberIdSet(s);
  for (const line of [...existing.payers, ...existing.shares]) allowed.add(line.memberId);
  const fields = { ...input, category: input.category ?? existing.category };
  const checked = checkExpense(s, fields, allowed, existing);
  if (!checked.ok) return fail(checked.error);

  const next: Expense = {
    ...existing,
    ...checked.row,
    payers: checked.payers,
    shares: checked.shares,
    updatedAt: ctx.now,
  };
  const batch = emptyBatch();
  batch.expenses.push(expenseWire(next, input.expectedVersion, s.group.currency));
  batch.activity.push(
    activity(
      ctx,
      s.group.id,
      'expense',
      existing.id,
      'update',
      me.id,
      expenseSnapshot(existing, existing.payers, existing.shares),
      expenseSnapshot(next, checked.payers, checked.shares),
    ),
  );
  return { ok: true, plan: { groupId: s.group.id, entityId: existing.id, batch } };
}

function planExpenseDelete(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['expense.delete']): PlanResult<'expense.delete'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const existing = s.expenses.find((e) => e.id === input.expenseId.toLowerCase());
  if (!existing) return fail({ code: 'NOT_FOUND' });
  if (existing.version !== input.expectedVersion) return fail({ code: 'STALE' });

  const batch = emptyBatch();
  batch.expenses.push(expenseWire({ ...existing, deletedAt: ctx.now, updatedAt: ctx.now }, input.expectedVersion, s.group.currency));
  batch.activity.push(
    activity(ctx, s.group.id, 'expense', existing.id, 'delete', me.id, expenseSnapshot(existing, existing.payers, existing.shares), null),
  );
  return { ok: true, plan: { groupId: s.group.id, entityId: existing.id, batch } };
}

function planSettlementAdd(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['settlement.add']): PlanResult<'settlement.add'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const id = input.id.toLowerCase();
  if (!isUuid(id) || s.settlements.some((x) => x.id === id)) return fail({ code: 'ID_TAKEN' });

  const from = input.fromMemberId.toLowerCase();
  const to = input.toMemberId.toLowerCase();
  if (from === to) return fail({ code: 'SAME_PERSON' });
  const allowed = activeMemberIdSet(s);
  for (const memberId of [from, to]) if (!allowed.has(memberId)) return fail({ code: 'UNKNOWN_MEMBER', memberId });
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0 || input.amountPaise > maxAmountMinor(s.group.currency)) {
    return fail({ code: 'INVALID_AMOUNT' });
  }
  if (!isSettlementMethod(input.method)) return fail({ code: 'INVALID_METHOD' });
  const note = input.note?.trim().replace(/\s+/g, ' ') || null;
  if (note && note.length > MAX_SETTLEMENT_NOTE_LENGTH) return fail({ code: 'NOTE_TOO_LONG', max: MAX_SETTLEMENT_NOTE_LENGTH });
  const settledAt = input.settledAt ?? ctx.now;
  if (!Number.isSafeInteger(settledAt) || settledAt <= 0 || settledAt > ctx.now + MAX_FUTURE_MS) return fail({ code: 'INVALID_TIME' });

  const t = ctx.now;
  const settlement: Settlement = {
    id,
    groupId: s.group.id,
    fromMemberId: from,
    toMemberId: to,
    amountPaise: input.amountPaise,
    method: input.method,
    note,
    settledAt,
    createdByMemberId: me.id,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    version: 0,
  };
  const batch = emptyBatch();
  batch.settlements.push(settlementWire(settlement, 0, s.group.currency));
  batch.activity.push(activity(ctx, s.group.id, 'settlement', id, 'create', me.id, null, settlementSnapshot(settlement)));
  return { ok: true, plan: { groupId: s.group.id, entityId: id, batch } };
}

function planSettlementDelete(
  state: GroupSnapshot | null,
  ctx: PlanContext,
  input: CommandInputs['settlement.delete'],
): PlanResult<'settlement.delete'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const existing = s.settlements.find((x) => x.id === input.settlementId.toLowerCase());
  if (!existing) return fail({ code: 'NOT_FOUND' });
  if (existing.version !== input.expectedVersion) return fail({ code: 'STALE' });

  const batch = emptyBatch();
  batch.settlements.push(settlementWire({ ...existing, deletedAt: ctx.now, updatedAt: ctx.now }, input.expectedVersion, s.group.currency));
  batch.activity.push(activity(ctx, s.group.id, 'settlement', existing.id, 'delete', me.id, settlementSnapshot(existing), null));
  return { ok: true, plan: { groupId: s.group.id, entityId: existing.id, batch } };
}

function checkRule(s: GroupSnapshot, fields: RuleFields, allowed: Set<string>, current: { categoryLabel: string | null } | null) {
  type R = { ok: false; error: RuleError };
  if (fields.category !== undefined && !isExpenseCategory(fields.category)) return { ok: false, error: { code: 'INVALID_CATEGORY' } } as R;
  const schedule = validateSchedule(fields);
  if (schedule) return { ok: false, error: { code: 'SCHEDULE', error: schedule } } as R;
  if (typeof fields.timeZone !== 'string' || !TZ.test(fields.timeZone)) return { ok: false, error: { code: 'INVALID_TIME_ZONE' } } as R;

  const valid = validateExpense(
    {
      description: fields.description,
      amountPaise: fields.amountPaise,
      expenseDate: fields.startDate,
      payers: fields.payers,
      splitInput: fields.splitInput,
      currency: s.group.currency,
    },
    allowed,
  );
  if (!valid.ok) return { ok: false, error: valid.error } as R;
  const category = fields.category ?? 'general';
  const label = resolveCategoryLabel(category, fields.categoryLabel ?? null, current?.categoryLabel ?? null);
  if (!label.ok) return { ok: false, error: { code: 'CATEGORY_LABEL_TOO_LONG' } } as R;
  const note = normalizeNote(fields.note ?? null);
  if (!note.ok) return { ok: false, error: { code: 'NOTE_TOO_LONG' } } as R;

  const lines = (rows: readonly PayerLine[]): RuleLine[] =>
    rows.map((l) => ({ memberId: l.memberId, amountPaise: l.amountPaise })).sort(byMemberId);
  return {
    ok: true as const,
    row: {
      description: valid.description,
      amountPaise: fields.amountPaise,
      category,
      categoryLabel: label.label,
      note: note.note,
      splitInput: fields.splitInput,
      payers: lines(valid.payers),
      shares: lines(valid.shares),
      frequency: fields.frequency,
      startDate: fields.startDate,
      endDate: fields.endDate,
      timeZone: fields.timeZone,
    },
  };
}

/** Rule changes are logged on the group (activity entity types are fixed). */
const ruleEntry = (
  ctx: PlanContext,
  rule: Pick<RecurringRule, 'id' | 'groupId' | 'description' | 'frequency' | 'startDate'>,
  ruleAction: 'create' | 'update' | 'delete',
  actor: string,
) =>
  activity(ctx, rule.groupId, 'group', rule.groupId, 'update', actor, null, {
    recurringRule: { id: rule.id, description: rule.description, frequency: rule.frequency, startDate: rule.startDate },
    ruleAction,
  });

function planRuleCreate(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['recurring.create']): PlanResult<'recurring.create'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const id = input.id.toLowerCase();
  if (!isUuid(id) || s.rules.some((r) => r.id === id)) return fail({ code: 'ID_TAKEN' });
  const checked = checkRule(s, input, activeMemberIdSet(s), null);
  if (!checked.ok) return fail(checked.error);

  const t = ctx.now;
  const rule: RecurringRule = {
    id,
    groupId: s.group.id,
    ...checked.row,
    createdByMemberId: me.id,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    version: 0,
  };
  const batch = emptyBatch();
  batch.recurring_rules.push(ruleWire(rule, 0, s.group.currency));
  batch.activity.push(ruleEntry(ctx, rule, 'create', me.id));
  return { ok: true, plan: { groupId: s.group.id, entityId: id, batch, generateRuleId: id } };
}

function planRuleUpdate(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['recurring.update']): PlanResult<'recurring.update'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const rule = s.rules.find((r) => r.id === input.ruleId.toLowerCase());
  if (!rule) return fail({ code: 'NOT_FOUND' });
  if (rule.version !== input.expectedVersion) return fail({ code: 'STALE' });
  const scheduleChanged = rule.frequency !== input.frequency || rule.startDate !== input.startDate;
  if (scheduleChanged && s.rulesWithOccurrences.includes(rule.id)) return fail({ code: 'SCHEDULE_LOCKED' });

  const checked = checkRule(s, input, activeMemberIdSet(s), rule);
  if (!checked.ok) return fail(checked.error);
  // The time zone stays the creator's: the day an occurrence is due must not move between phones.
  const next: RecurringRule = { ...rule, ...checked.row, timeZone: rule.timeZone, updatedAt: ctx.now };
  const batch = emptyBatch();
  batch.recurring_rules.push(ruleWire(next, input.expectedVersion, s.group.currency));
  batch.activity.push(ruleEntry(ctx, next, 'update', me.id));
  return { ok: true, plan: { groupId: s.group.id, entityId: rule.id, batch, generateRuleId: rule.id } };
}

function planRuleDelete(state: GroupSnapshot | null, ctx: PlanContext, input: CommandInputs['recurring.delete']): PlanResult<'recurring.delete'> {
  const me = actorIn(state, ctx);
  if (isErr(me)) return fail(me);
  const s = state!;
  const rule = s.rules.find((r) => r.id === input.ruleId.toLowerCase());
  if (!rule) return fail({ code: 'NOT_FOUND' });
  if (rule.version !== input.expectedVersion) return fail({ code: 'STALE' });
  const batch = emptyBatch();
  batch.recurring_rules.push(ruleWire({ ...rule, deletedAt: ctx.now, updatedAt: ctx.now }, input.expectedVersion, s.group.currency));
  batch.activity.push(ruleEntry(ctx, rule, 'delete', me.id));
  return { ok: true, plan: { groupId: s.group.id, entityId: rule.id, batch } };
}

/**
 * Plan one command against the group as it is now (`state`; null only for group.create).
 * Never throws for bad input: every problem comes back as an error code.
 */
export function planCommand<K extends CommandOp>(
  state: GroupSnapshot | null,
  ctx: PlanContext,
  cmd: { op: K; input: CommandInputs[K] },
): PlanResult<K> {
  const c = cmd as Command;
  let result: PlanResult;
  try {
    switch (c.op) {
      case 'group.create':
        result = planGroupCreate(state, ctx, c.input);
        break;
      case 'group.update':
        result = planGroupUpdate(state, ctx, c.input);
        break;
      case 'group.delete':
        result = planGroupDelete(state, ctx, c.input);
        break;
      case 'member.add':
        result = planMemberAdd(state, ctx, c.input);
        break;
      case 'member.update':
        result = planMemberUpdate(state, ctx, c.input);
        break;
      case 'member.remove':
        result = planMemberRemove(state, ctx, c.input);
        break;
      case 'expense.add':
        result = planExpenseAdd(state, ctx, c.input);
        break;
      case 'expense.update':
        result = planExpenseUpdate(state, ctx, c.input);
        break;
      case 'expense.delete':
        result = planExpenseDelete(state, ctx, c.input);
        break;
      case 'settlement.add':
        result = planSettlementAdd(state, ctx, c.input);
        break;
      case 'settlement.delete':
        result = planSettlementDelete(state, ctx, c.input);
        break;
      case 'recurring.create':
        result = planRuleCreate(state, ctx, c.input);
        break;
      case 'recurring.update':
        result = planRuleUpdate(state, ctx, c.input);
        break;
      case 'recurring.delete':
        result = planRuleDelete(state, ctx, c.input);
        break;
      default:
        result = { ok: false, error: { code: 'NOT_FOUND' } };
    }
  } catch {
    // Malformed input (wrong types from an untrusted client): reject rather than crash.
    result = { ok: false, error: { code: 'INVALID_INPUT' } };
  }
  return result as PlanResult<K>;
}

// ── Applying a plan to a cached snapshot (optimistic display) ──────────

const upsert = <T extends { id: string }>(rows: readonly T[], row: T): T[] => {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i === -1) return [...rows, row];
  const copy = [...rows];
  copy[i] = row;
  return copy;
};

/**
 * The snapshot as it will look once the plan is stored. Rows get version + 1 (what the server
 * assigns), so a follow-up edit made before the refetch still carries the right base version.
 * Deleted expenses, payments and rules drop out, as they do in server snapshots.
 */
export function applyPlan(snapshot: GroupSnapshot | null, plan: Plan): GroupSnapshot | null {
  const b = plan.batch;
  const bump = <T extends { base_version: number }>(w: T) => ({ ...w, version: w.base_version + 1 });
  let s = snapshot;
  for (const w of b.groups) {
    const group = groupFromWire(bump(w));
    if (!s) {
      s = { rev: 'local', group, members: [], expenses: [], settlements: [], rules: [], currencyLocked: false, rulesWithOccurrences: [] };
    } else {
      s = { ...s, group };
    }
  }
  if (!s) return null;
  let { members, expenses, settlements, rules } = s;
  for (const w of b.members) members = upsert(members, memberFromWire(bump(w)));
  for (const w of b.expenses) {
    const e = expenseFromWire(bump(w));
    expenses = e.deletedAt === null ? upsert(expenses, e) : expenses.filter((x) => x.id !== e.id);
  }
  for (const w of b.settlements) {
    const x = settlementFromWire(bump(w));
    settlements = x.deletedAt === null ? upsert(settlements, x) : settlements.filter((y) => y.id !== x.id);
  }
  for (const w of b.recurring_rules) {
    const r = ruleFromWire(bump(w));
    rules = r.deletedAt === null ? upsert(rules, r) : rules.filter((y) => y.id !== r.id);
  }
  return {
    ...s,
    rev: `${s.rev}+`,
    members,
    expenses: [...expenses].sort(compareExpensesNewestFirst),
    settlements: [...settlements].sort((a, c) => c.settledAt - a.settledAt),
    rules,
    currencyLocked: s.currencyLocked || b.expenses.length > 0 || b.settlements.length > 0 || b.recurring_rules.length > 0,
  };
}

/** History entries a plan adds (for showing them before the server answers). */
export const planActivity = (plan: Plan): ActivityEntry[] => plan.batch.activity.map(activityFromWire);

/** The foreign-bill part of a stored expense, or null. */
export function expenseForeign(e: Pick<Expense, 'originalCurrency' | 'originalAmountMinor' | 'fxRate'>): ForeignAmount | null {
  return e.originalCurrency && e.originalAmountMinor !== null && e.fxRate
    ? { currency: e.originalCurrency, amountMinor: e.originalAmountMinor, rate: e.fxRate }
    : null;
}
