import { eq, sql } from 'drizzle-orm';

import type { RepoContext } from '@/db/context';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  settings,
  settlements,
} from '@/db/schema';
import { err, ok, type Result } from '@/lib/result';

import { issueTitle, rejectionReason, summarizeRow } from './describeIssue';
import { getSyncIssues, SYNC_ISSUES_KEY, type SyncIssue } from './engine';
import {
  activityToWire,
  expenseToWire,
  groupToWire,
  memberToWire,
  settlementToWire,
  type VersionedTable,
  type WireTable,
} from './wire';

/** Groups to full-fetch on the next sync (used to restore server copies of discarded changes). */
export const SYNC_REFETCH_GROUPS_KEY = 'sync_refetch_group_ids';

const keyOf = (table: WireTable, id: string) => `${table}:${id}`;

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

const readSetting = (ctx: RepoContext, key: string) =>
  ctx.db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

function writeSetting(ctx: RepoContext, key: string, value: string): void {
  ctx.db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

const writeIssues = (ctx: RepoContext, issues: SyncIssue[]) =>
  writeSetting(ctx, SYNC_ISSUES_KEY, JSON.stringify(issues));

export const getRefetchGroupIds = (ctx: RepoContext): string[] =>
  parseList(readSetting(ctx, SYNC_REFETCH_GROUPS_KEY));

export function clearRefetchGroupIds(ctx: RepoContext, done: readonly string[]): void {
  const remaining = getRefetchGroupIds(ctx).filter((id) => !done.includes(id));
  writeSetting(ctx, SYNC_REFETCH_GROUPS_KEY, JSON.stringify(remaining));
}

/** Queue groups for a full fetch on the next sync. They stay queued until a full fetch completes. */
export function queueRefetchGroupIds(ctx: RepoContext, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const next = [...new Set([...getRefetchGroupIds(ctx), ...ids])];
  writeSetting(ctx, SYNC_REFETCH_GROUPS_KEY, JSON.stringify(next));
}
/** Rows waiting to be pushed (including ones blocked by an issue). */
export function countPendingChanges(ctx: RepoContext): number {
  const count = sql<number>`count(*)`;
  const db = ctx.db;
  return (
    (db.select({ n: count }).from(groups).where(eq(groups.dirty, true)).get()?.n ?? 0) +
    (db.select({ n: count }).from(members).where(eq(members.dirty, true)).get()?.n ?? 0) +
    (db.select({ n: count }).from(expenses).where(eq(expenses.dirty, true)).get()?.n ?? 0) +
    (db.select({ n: count }).from(settlements).where(eq(settlements.dirty, true)).get()?.n ?? 0) +
    (db.select({ n: count }).from(activityLog).where(eq(activityLog.dirty, true)).get()?.n ?? 0)
  );
}

function rowState(ctx: RepoContext, table: VersionedTable, id: string): { groupId: string; version: number } | null {
  const db = ctx.db;
  switch (table) {
    case 'groups': {
      const r = db.select({ id: groups.id, version: groups.version }).from(groups).where(eq(groups.id, id)).get();
      return r ? { groupId: r.id, version: r.version } : null;
    }
    case 'members':
      return db.select({ groupId: members.groupId, version: members.version }).from(members).where(eq(members.id, id)).get() ?? null;
    case 'expenses':
      return db.select({ groupId: expenses.groupId, version: expenses.version }).from(expenses).where(eq(expenses.id, id)).get() ?? null;
    case 'settlements':
      return (
        db.select({ groupId: settlements.groupId, version: settlements.version }).from(settlements).where(eq(settlements.id, id)).get() ??
        null
      );
  }
}

/** Clear a rejection so the row is sent again (after a transient problem or an app update). */
export function retryRejectedChange(ctx: RepoContext, table: WireTable, id: string): Result<void, { code: 'NOT_FOUND' }> {
  const issues = getSyncIssues(ctx);
  if (!issues.some((i) => i.kind === 'rejected' && i.table === table && i.id === id)) return err({ code: 'NOT_FOUND' });
  writeIssues(ctx, issues.filter((i) => keyOf(i.table, i.id) !== keyOf(table, id)));
  return ok(undefined);
}

export type DiscardError = { code: 'NOT_FOUND' } | { code: 'NOT_ON_SERVER' };

/**
 * Throw away a rejected local change and take the server's copy instead.
 * The row is marked clean at version 0, so the next full fetch of its group overwrites it.
 */
export function discardLocalChange(ctx: RepoContext, table: VersionedTable, id: string): Result<void, DiscardError> {
  const issues = getSyncIssues(ctx);
  if (!issues.some((i) => i.kind === 'rejected' && i.table === table && i.id === id)) return err({ code: 'NOT_FOUND' });
  const state = rowState(ctx, table, id);
  if (!state) return err({ code: 'NOT_FOUND' });
  if (state.version === 0) return err({ code: 'NOT_ON_SERVER' });

  const refetch = getRefetchGroupIds(ctx);
  ctx.db.transaction((tx) => {
    switch (table) {
      case 'groups':
        tx.update(groups).set({ version: 0, dirty: false, updatedAt: sql`${groups.updatedAt}` }).where(eq(groups.id, id)).run();
        break;
      case 'members':
        tx.update(members).set({ version: 0, dirty: false, updatedAt: sql`${members.updatedAt}` }).where(eq(members.id, id)).run();
        break;
      case 'expenses':
        tx.update(expenses).set({ version: 0, dirty: false, updatedAt: sql`${expenses.updatedAt}` }).where(eq(expenses.id, id)).run();
        break;
      case 'settlements':
        tx.update(settlements)
          .set({ version: 0, dirty: false, updatedAt: sql`${settlements.updatedAt}` })
          .where(eq(settlements.id, id))
          .run();
        break;
    }
    const remaining = issues.filter((i) => keyOf(i.table, i.id) !== keyOf(table, id));
    tx.insert(settings)
      .values({ key: SYNC_ISSUES_KEY, value: JSON.stringify(remaining) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(remaining) } })
      .run();
    const nextRefetch = JSON.stringify([...new Set([...refetch, state.groupId])]);
    tx.insert(settings)
      .values({ key: SYNC_REFETCH_GROUPS_KEY, value: nextRefetch })
      .onConflictDoUpdate({ target: settings.key, set: { value: nextRefetch } })
      .run();
  });

  return ok(undefined);
}

// ── Views for the Sync screen ──────────────────────────────────────────────

export interface IssueView {
  key: string;
  issue: SyncIssue;
  title: string;
  mine: string[];
  /** null for rejections, or for a conflict whose server copy has not been pulled yet. */
  theirs: string[] | null;
  reason: string | null;
  canDiscard: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asRecord = (v: object | null) => v as Record<string, unknown> | null;

function localWire(ctx: RepoContext, table: WireTable, id: string): Record<string, unknown> | null {
  const db = ctx.db;
  switch (table) {
    case 'groups': {
      const r = db.select().from(groups).where(eq(groups.id, id)).get();
      return asRecord(r ? groupToWire(r) : null);
    }
    case 'members': {
      const r = db.select().from(members).where(eq(members.id, id)).get();
      return asRecord(r ? memberToWire(r) : null);
    }
    case 'expenses': {
      const r = db.select().from(expenses).where(eq(expenses.id, id)).get();
      if (!r) return null;
      const payers = db.select().from(expensePayers).where(eq(expensePayers.expenseId, id)).all();
      const shares = db.select().from(expenseShares).where(eq(expenseShares.expenseId, id)).all();
      return asRecord(expenseToWire(r, payers, shares));
    }
    case 'settlements': {
      const r = db.select().from(settlements).where(eq(settlements.id, id)).get();
      return asRecord(r ? settlementToWire(r) : null);
    }
    case 'activity': {
      const r = db.select().from(activityLog).where(eq(activityLog.id, id)).get();
      return asRecord(r ? activityToWire(r) : null);
    }
  }
}

export function loadIssueViews(ctx: RepoContext): IssueView[] {
  const issues = getSyncIssues(ctx);
  if (issues.length === 0) return [];

  const names = new Map(
    ctx.db
      .select({ id: members.id, name: members.displayName })
      .from(members)
      .all()
      .map((m) => [m.id, m.name] as const),
  );
  const nameOf = (memberId: string) => names.get(memberId) ?? 'someone';

  return issues.map((issue) => {
    const local = localWire(ctx, issue.table, issue.id);
    const server = isRecord(issue.serverRow) ? issue.serverRow : null;
    const versioned = issue.table !== 'activity';
    return {
      key: keyOf(issue.table, issue.id),
      issue,
      title: issueTitle(issue.table, local ?? server),
      mine: summarizeRow(issue.table, local, nameOf),
      theirs: issue.kind === 'conflict' && server ? summarizeRow(issue.table, server, nameOf) : null,
      reason: issue.kind === 'rejected' ? rejectionReason(issue.code, issue.detail) : null, canDiscard:
        issue.kind === 'rejected' && versioned && (rowState(ctx, issue.table as VersionedTable, issue.id)?.version ?? 0) > 0,
    };
  });
}