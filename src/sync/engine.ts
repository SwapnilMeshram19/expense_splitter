import { and, eq, inArray, sql } from 'drizzle-orm';

import type { RepoContext, Tx } from '@/db/context';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  settings,
  settlements,
  type ActivityLogEntry,
  type ExpenseCategory,
  type SettlementMethod,
  type StoredSplitInput,
} from '@/db/schema';
import { err, ok, type Result } from '@/lib/result';

import {
  activityToWire,
  expenseToWire,
  groupToWire,
  memberToWire,
  sameContent,
  settlementToWire,
  type Incoming,
  type PullResult,
  type PushBatch,
  type PushResult,
  type VersionedTable,
  type WireExpense,
  type WireGroup,
  type WireMember,
  type WireSettlement,
  type WireTable,
} from './wire';

export const MAX_BATCH_ROWS = 400;
export const SYNC_CURSOR_KEY = 'sync_cursor';
export const SYNC_ISSUES_KEY = 'sync_issues';
export const SYNC_LOST_GROUPS_KEY = 'sync_lost_group_ids';

/** Foreign-key violation: a referenced row is simply not on the server yet. Retry, don't block. */
const RETRYABLE_DETAIL = '23503';

export interface SyncIssue {
  kind: 'conflict' | 'rejected';
  table: WireTable;
  id: string;
  serverVersion?: number;
  /** Latest server copy (arrives with a pull); needed for "keep theirs". */
  serverRow?: unknown;
  code?: string;
  detail?: string;
  detectedAt: number;
}

const keyOf = (table: WireTable, id: string) => `${table}:${id}`;

// ── Local sync state (settings table: local-only, never synced) ─────────────

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const readSettingTx = (tx: Tx, key: string) =>
  tx.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

const readSetting = (ctx: RepoContext, key: string) =>
  ctx.db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

function writeSetting(tx: Tx, key: string, value: string): void {
  tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

const readIssuesTx = (tx: Tx) => parseJson<SyncIssue[]>(readSettingTx(tx, SYNC_ISSUES_KEY), []);
const writeIssues = (tx: Tx, issues: Iterable<SyncIssue>) =>
  writeSetting(tx, SYNC_ISSUES_KEY, JSON.stringify([...issues]));

export const getSyncIssues = (ctx: RepoContext): SyncIssue[] =>
  parseJson<SyncIssue[]>(readSetting(ctx, SYNC_ISSUES_KEY), []);
export const getLostGroupIds = (ctx: RepoContext): string[] =>
  parseJson<string[]>(readSetting(ctx, SYNC_LOST_GROUPS_KEY), []);
export const getSyncCursor = (ctx: RepoContext): string | null => readSetting(ctx, SYNC_CURSOR_KEY);

// The four versioned tables share id / updatedAt / version / dirty columns. Typed through one of
// them so the same bookkeeping update can be written once.
const VERSIONED = { groups, members, expenses, settlements } as const;
const versionedTable = (name: VersionedTable) => VERSIONED[name] as unknown as typeof groups;

// ── Push: collect ──────────────────────────────────────────────────────────

export interface CollectedBatch {
  batch: PushBatch;
  /** updated_at of each versioned row as sent, to detect edits made while the push is in flight. */
  sentUpdatedAt: Map<string, number>;
  size: number;
}

/** Dirty rows in foreign-key order. Rows with an open issue wait for the user. */
export function collectPushBatch(ctx: RepoContext, limit: number = MAX_BATCH_ROWS): CollectedBatch | null {
  const db = ctx.db;
  const blocked = new Set(getSyncIssues(ctx).map((i) => keyOf(i.table, i.id)));
  const open = <T extends { id: string }>(table: WireTable, rows: T[]) =>
    rows.filter((r) => !blocked.has(keyOf(table, r.id)));

  let room = limit;
  const take = <T>(rows: T[]): T[] => {
    const picked = rows.slice(0, Math.max(room, 0));
    room -= picked.length;
    return picked;
  };

  const groupRows = take(open('groups', db.select().from(groups).where(eq(groups.dirty, true)).all()));

  // The server accepts a new group only together with the caller's member row, so the members of
  // groups created in this batch always travel with it, whatever the limit.
  const newGroupIds = new Set(groupRows.filter((g) => g.version === 0).map((g) => g.id));
  const dirtyMembers = open('members', db.select().from(members).where(eq(members.dirty, true)).all());
  const forcedMembers = dirtyMembers.filter((m) => newGroupIds.has(m.groupId));
  room -= forcedMembers.length;
  const memberRows = [...forcedMembers, ...take(dirtyMembers.filter((m) => !newGroupIds.has(m.groupId)))];

  const expenseRows = take(open('expenses', db.select().from(expenses).where(eq(expenses.dirty, true)).all()));
  const settlementRows = take(
    open('settlements', db.select().from(settlements).where(eq(settlements.dirty, true)).all()),
  );
  const activityRows = take(open('activity', db.select().from(activityLog).where(eq(activityLog.dirty, true)).all()));

  const size = groupRows.length + memberRows.length + expenseRows.length + settlementRows.length + activityRows.length;
  if (size === 0) return null;

  const expenseIds = expenseRows.map((e) => e.id);
  const payerRows = expenseIds.length
    ? db.select().from(expensePayers).where(inArray(expensePayers.expenseId, expenseIds)).all()
    : [];
  const shareRows = expenseIds.length
    ? db.select().from(expenseShares).where(inArray(expenseShares.expenseId, expenseIds)).all()
    : [];

  const sentUpdatedAt = new Map<string, number>();
  const remember = (table: VersionedTable, row: { id: string; updatedAt: number }) =>
    sentUpdatedAt.set(keyOf(table, row.id), row.updatedAt);

  // Every expense/settlement asserts the currency its amounts are in (see WireExpense.group_currency).
  const currencyOf = new Map(
    db
      .select({ id: groups.id, currency: groups.currency })
      .from(groups)
      .all()
      .map((g) => [g.id, g.currency]),
  );
  const groupCurrency = (groupId: string) => currencyOf.get(groupId) ?? 'INR';

  const batch: PushBatch = {
    groups: groupRows.map((g) => {
      remember('groups', g);
      return { ...groupToWire(g), base_version: g.version };
    }),
    members: memberRows.map((m) => {
      remember('members', m);
      return { ...memberToWire(m), base_version: m.version };
    }),
    expenses: expenseRows.map((e) => {
      remember('expenses', e);
      return {
        ...expenseToWire(
          e,
          payerRows.filter((p) => p.expenseId === e.id),
          shareRows.filter((s) => s.expenseId === e.id),
        ),
        group_currency: groupCurrency(e.groupId),
        base_version: e.version,
      };
    }),
    settlements: settlementRows.map((s) => {
      remember('settlements', s);
      return {
        ...settlementToWire(s),
        group_currency: groupCurrency(s.groupId),
        base_version: s.version,
      };
    }),
    activity: activityRows.map(activityToWire),
  };

  return { batch, sentUpdatedAt, size };
}

// ── Push: acknowledge ──────────────────────────────────────────────────────

function ackVersioned(tx: Tx, name: VersionedTable, id: string, version: number, sentUpdatedAt: number): void {
  const t = versionedTable(name);
  const cleared = tx
    .update(t)
    .set({ version, dirty: false, updatedAt: sentUpdatedAt })
    .where(and(eq(t.id, id), eq(t.updatedAt, sentUpdatedAt)))
    .returning({ id: t.id })
    .all();
  if (cleared.length === 0) {
    // Edited again while the push was in flight: stay dirty, now on top of the new server version.
    tx.update(t).set({ version, updatedAt: sql`${t.updatedAt}` }).where(eq(t.id, id)).run();
  }
}

export function applyPushResult(ctx: RepoContext, collected: CollectedBatch, result: PushResult): void {
  const now = ctx.now();

  ctx.db.transaction((tx) => {
    const issues = new Map(readIssuesTx(tx).map((i) => [keyOf(i.table, i.id), i] as const));

    for (const o of result.applied) {
      const key = keyOf(o.table, o.id);
      if (o.table === 'activity') {
        tx.update(activityLog).set({ dirty: false }).where(eq(activityLog.id, o.id)).run();
      } else {
        const sent = collected.sentUpdatedAt.get(key);
        if (sent === undefined || typeof o.version !== 'number') continue;
        ackVersioned(tx, o.table, o.id, o.version, sent);
      }
      issues.delete(key);
    }

    for (const o of result.conflicts) {
      const key = keyOf(o.table, o.id);
      issues.set(key, {
        ...issues.get(key),
        kind: 'conflict',
        table: o.table,
        id: o.id,
        serverVersion: o.server_version,
        detectedAt: now,
      });
    }

    for (const o of result.rejected) {
      if (o.detail === RETRYABLE_DETAIL) continue; // stays dirty; goes out again next round
      issues.set(keyOf(o.table, o.id), {
        kind: 'rejected',
        table: o.table,
        id: o.id,
        code: o.code ?? 'UNKNOWN',
        detail: o.detail,
        detectedAt: now,
      });
    }

    writeIssues(tx, issues.values());
  });
}

// ── Pull: writers ──────────────────────────────────────────────────────────

type WriteMode = 'insert' | 'overwrite';

function writeGroup(tx: Tx, g: Incoming<WireGroup>, mode: WriteMode): void {
  const values = {
    name: g.name,
    simplifyDebts: g.simplify_debts,
    // A server from before multi-currency doesn't send it: every group there is INR.
    currency: typeof g.currency === 'string' ? g.currency : 'INR',
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    deletedAt: g.deleted_at,
    version: g.version,
    dirty: false,
  };
  if (mode === 'insert') tx.insert(groups).values({ id: g.id, ...values }).run();
  else tx.update(groups).set(values).where(eq(groups.id, g.id)).run();
}

function writeMember(tx: Tx, m: Incoming<WireMember>, mode: WriteMode): void {
  const values = {
    groupId: m.group_id,
    displayName: m.display_name,
    userId: m.user_id,
    upiVpa: m.upi_vpa,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    deletedAt: m.deleted_at,
    version: m.version,
    dirty: false,
  };
  if (mode === 'insert') tx.insert(members).values({ id: m.id, ...values }).run();
  else tx.update(members).set(values).where(eq(members.id, m.id)).run();
}

function writeExpense(tx: Tx, e: Incoming<WireExpense>, mode: WriteMode): void {
  const values = {
    groupId: e.group_id,
    description: e.description,
    amountPaise: e.amount_paise,
    category: e.category as ExpenseCategory,
    // Only meaningful with 'other'. A server that doesn't send the field at all (deployed before
    // custom categories) leaves the local label alone, like the server does for old app builds.
    ...(e.category !== 'other'
      ? { categoryLabel: null }
      : 'category_label' in e
        ? { categoryLabel: typeof e.category_label === 'string' ? e.category_label : null }
        : {}),
    expenseDate: e.expense_date,
    splitInput: e.split_input as StoredSplitInput,
    createdByMemberId: e.created_by_member_id,
    // Absent only from servers before multi-currency, where no foreign bills exist.
    originalCurrency: typeof e.original_currency === 'string' ? e.original_currency : null,
    originalAmountMinor:
      typeof e.original_amount_minor === 'number' ? e.original_amount_minor : null,
    fxRate: typeof e.fx_rate === 'string' ? e.fx_rate : null,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    deletedAt: e.deleted_at,
    version: e.version,
    dirty: false,
  };
  if (mode === 'insert') {
    tx.insert(expenses).values({ id: e.id, ...values }).run();
  } else {
    tx.update(expenses).set(values).where(eq(expenses.id, e.id)).run();
    tx.delete(expensePayers).where(eq(expensePayers.expenseId, e.id)).run();
    tx.delete(expenseShares).where(eq(expenseShares.expenseId, e.id)).run();
  }
  if (e.payers.length > 0) {
    tx.insert(expensePayers)
      .values(
        e.payers.map((l) => ({
          expenseId: e.id,
          memberId: l.member_id,
          amountPaise: l.amount_paise,
          originalAmountMinor:
            typeof l.original_amount_minor === 'number' ? l.original_amount_minor : null,
        })),
      )
      .run();
  }
  if (e.shares.length > 0) {
    tx.insert(expenseShares)
      .values(e.shares.map((l) => ({ expenseId: e.id, memberId: l.member_id, amountPaise: l.amount_paise })))
      .run();
  }
}

function writeSettlement(tx: Tx, s: Incoming<WireSettlement>, mode: WriteMode): void {
  const values = {
    groupId: s.group_id,
    fromMemberId: s.from_member_id,
    toMemberId: s.to_member_id,
    amountPaise: s.amount_paise,
    method: s.method as SettlementMethod,
    note: s.note,
    settledAt: s.settled_at,
    createdByMemberId: s.created_by_member_id,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    deletedAt: s.deleted_at,
    version: s.version,
    dirty: false,
  };
  if (mode === 'insert') tx.insert(settlements).values({ id: s.id, ...values }).run();
  else tx.update(settlements).set(values).where(eq(settlements.id, s.id)).run();
}

function writeServerRow(tx: Tx, table: VersionedTable, row: unknown, mode: WriteMode): void {
  switch (table) {
    case 'groups':
      return writeGroup(tx, row as Incoming<WireGroup>, mode);
    case 'members':
      return writeMember(tx, row as Incoming<WireMember>, mode);
    case 'expenses':
      return writeExpense(tx, row as Incoming<WireExpense>, mode);
    case 'settlements':
      return writeSettlement(tx, row as Incoming<WireSettlement>, mode);
  }
}

function expenseWire(tx: Tx, id: string): WireExpense | null {
  const e = tx.select().from(expenses).where(eq(expenses.id, id)).get();
  if (!e) return null;
  const payers = tx.select().from(expensePayers).where(eq(expensePayers.expenseId, id)).all();
  const shares = tx.select().from(expenseShares).where(eq(expenseShares.expenseId, id)).all();
  return expenseToWire(e, payers, shares);
}

// ── Pull: apply ────────────────────────────────────────────────────────────

export interface PullStats {
  written: number;
  conflicts: number;
}

export interface ApplyPullOptions {
  /**
   * Save pull.cursor as the sync cursor (default true). runSync passes false for mid-pass pages of
   * a full fetch, so an interrupted full fetch restarts instead of resuming half-way.
   */
  saveCursor?: boolean;
}

/**
 * Applies one pull page atomically.
 * Clean rows take newer server versions. Dirty rows are never overwritten: identical content is
 * adopted (a lost push response), anything else becomes a conflict for the user to resolve.
 */
export function applyPull(ctx: RepoContext, pull: PullResult, options: ApplyPullOptions = {}): PullStats {
  const now = ctx.now();
  const stats: PullStats = { written: 0, conflicts: 0 };

  ctx.db.transaction((tx) => {
    const issues = new Map(readIssuesTx(tx).map((i) => [keyOf(i.table, i.id), i] as const));

    // Rows of a group this phone does not have yet arrive with that group's full fetch instead.
    const knownGroups = new Set(tx.select({ id: groups.id }).from(groups).all().map((g) => g.id));
    for (const g of pull.groups) knownGroups.add(g.id);

    const apply = (
      table: VersionedTable,
      server: { id: string; version: number },
      local: { version: number; dirty: boolean } | undefined,
      localWire: () => object | null,
    ) => {
      const key = keyOf(table, server.id);
      if (!local) {
        writeServerRow(tx, table, server, 'insert');
        stats.written++;
        return;
      }
      if (!local.dirty) {
        if (server.version > local.version) {
          writeServerRow(tx, table, server, 'overwrite');
          issues.delete(key);
          stats.written++;
        }
        return;
      }
      const mine = localWire();
      if (mine && sameContent(mine, server)) {
        const t = versionedTable(table);
        tx.update(t)
          .set({ version: server.version, dirty: false, updatedAt: sql`${t.updatedAt}` })
          .where(eq(t.id, server.id))
          .run();
        issues.delete(key);
        stats.written++;
        return;
      }
      if (server.version > local.version) {
        issues.set(key, {
          ...issues.get(key),
          kind: 'conflict',
          table,
          id: server.id,
          serverVersion: server.version,
          serverRow: server,
          detectedAt: now,
        });
        stats.conflicts++;
      }
    };

    for (const g of pull.groups) {
      const local = tx.select().from(groups).where(eq(groups.id, g.id)).get();
      apply('groups', g, local, () => (local ? groupToWire(local) : null));
    }
    for (const m of pull.members) {
      if (!knownGroups.has(m.group_id)) continue;
      const local = tx.select().from(members).where(eq(members.id, m.id)).get();
      apply('members', m, local, () => (local ? memberToWire(local) : null));
    }
    for (const e of pull.expenses) {
      if (!knownGroups.has(e.group_id)) continue;
      const local = tx.select().from(expenses).where(eq(expenses.id, e.id)).get();
      apply('expenses', e, local, () => expenseWire(tx, e.id));
    }
    for (const s of pull.settlements) {
      if (!knownGroups.has(s.group_id)) continue;
      const local = tx.select().from(settlements).where(eq(settlements.id, s.id)).get();
      apply('settlements', s, local, () => (local ? settlementToWire(local) : null));
    }
    for (const a of pull.activity) {
      if (!knownGroups.has(a.group_id)) continue;
      const inserted = tx
        .insert(activityLog)
        .values({
          id: a.id,
          groupId: a.group_id,
          entityType: a.entity_type as ActivityLogEntry['entityType'],
          entityId: a.entity_id,
          action: a.action as ActivityLogEntry['action'],
          actorMemberId: a.actor_member_id,
          before: a.before ?? null,
          after: a.after ?? null,
          createdAt: a.created_at,
          dirty: false,
        })
        .onConflictDoNothing()
        .returning({ id: activityLog.id })
        .all();
      stats.written += inserted.length;
    }

    // Groups that were synced before but are no longer visible: removed from the group.
    const visible = new Set(pull.group_ids);
    const lost = tx
      .select({ id: groups.id, version: groups.version })
      .from(groups)
      .all()
      .filter((g) => g.version > 0 && !visible.has(g.id))
      .map((g) => g.id);

    writeSetting(tx, SYNC_LOST_GROUPS_KEY, JSON.stringify(lost));
    // Mid-pass cursors of a full fetch are not saved: an interrupted full fetch restarts.
    if (options.saveCursor !== false) writeSetting(tx, SYNC_CURSOR_KEY, pull.cursor);
    writeIssues(tx, issues.values());
  });

  return stats;
}

// ── Conflict resolution ────────────────────────────────────────────────────

export type ConflictChoice = 'mine' | 'theirs';
export type ResolveError = { code: 'NOT_FOUND' } | { code: 'NEEDS_PULL' };

/**
 * mine:   keep the local edit and push it on top of the server version (overwrites theirs).
 * theirs: replace the local row with the server copy received in the last pull.
 */
export function resolveConflict(
  ctx: RepoContext,
  table: VersionedTable,
  id: string,
  choice: ConflictChoice,
): Result<void, ResolveError> {
  const issue = getSyncIssues(ctx).find((i) => i.kind === 'conflict' && i.table === table && i.id === id);
  if (!issue || issue.serverVersion === undefined) return err({ code: 'NOT_FOUND' });
  if (choice === 'theirs' && issue.serverRow === undefined) return err({ code: 'NEEDS_PULL' });

  ctx.db.transaction((tx) => {
    if (choice === 'theirs') {
      writeServerRow(tx, table, issue.serverRow, 'overwrite');
    } else {
      const t = versionedTable(table);
      tx.update(t)
        .set({ version: issue.serverVersion, dirty: true, updatedAt: sql`${t.updatedAt}` })
        .where(eq(t.id, id))
        .run();
    }
    writeIssues(
      tx,
      readIssuesTx(tx).filter((i) => !(i.table === table && i.id === id)),
    );
  });

  return ok(undefined);
}