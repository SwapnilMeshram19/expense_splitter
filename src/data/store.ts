/**
 * The client's view of the server, shared by the Android app and the web app (plain TypeScript:
 * platform pieces are passed in).
 *
 * - `server`: group snapshots exactly as the server last sent them. Never edited locally.
 * - `ops`: changes this device made that the server hasn't confirmed yet (being sent, waiting in
 *   the offline queue, or refused).
 * - `view`: what screens show = server snapshots with the unconfirmed changes applied, re-planned
 *   with the shared planner every time, so a change always looks exactly like what the server will
 *   store.
 *
 * Saving: run(command) plans it locally (instant validation), shows it at once, sends it, then
 * refetches the group. Offline: new expenses, payments and groups wait in the queue; anything
 * else needs a connection.
 */
import type { Api, ApiErrorCode, CommandRequest, CommandResult, ServerCommandError } from '@/api/client';
import { isApiError } from '@/api/client';
import {
  applyPlan,
  commandGroupId,
  isQueueable,
  planCommand,
  type Command,
  type CommandError,
  type CommandInputs,
  type CommandOp,
} from '@/domain/commands';
import type { ActivityEntry, GroupSnapshot } from '@/domain/model';

/** Planning before the anonymous account exists (first launch offline). Never sent to the server. */
export const PENDING_USER = '00000000-0000-4000-8000-000000000000';

export type OpStatus = 'sending' | 'queued' | 'failed';

export interface PendingOp {
  requestId: string;
  groupId: string;
  cmd: Command;
  /** When the change was made: the local plan uses it as "now", so the change looks the same every time. */
  at: number;
  status: OpStatus;
  error?: CommandFailure;
}

export type CommandFailure =
  | CommandError
  | ServerCommandError
  | { code: 'OFFLINE' }
  | { code: 'UNAUTHENTICATED' }
  | { code: 'BAD_REQUEST' };

export type RunResult<K extends CommandOp = CommandOp> =
  | { ok: true; entityId: string; queued: boolean }
  | { ok: false; error: CommandError<K> | Exclude<CommandFailure, CommandError> };

export interface SavedState {
  userId: string | null;
  order: string[];
  groups: GroupSnapshot[];
  ops: PendingOp[];
}

/** Where the app keeps the cache and the queue between launches (absent on the web: memory only). */
export interface Persistence {
  load(): SavedState | null;
  saveMeta(meta: { userId: string | null; order: string[] }): void;
  saveGroup(snapshot: GroupSnapshot): void;
  removeGroup(groupId: string): void;
  clearGroups(): void;
  putOp(op: PendingOp): void;
  deleteOp(requestId: string): void;
}

export interface Network {
  isOnline(): boolean;
}

export interface DataStoreDeps {
  api: Api;
  persistence?: Persistence;
  network?: Network;
  now?: () => number;
  newId?: () => string;
  /** This device's id, sent with writes so it can ignore the change signal its own write causes. */
  origin?: () => string;
}

export interface DataStatus {
  /** The cache (or a first server answer) is in: screens can show data. */
  ready: boolean;
  /** At least one full answer from the server since launch. */
  loadedFromServer: boolean;
  refreshing: boolean;
  lastRefreshAt: number | null;
  error: ApiErrorCode | null;
  queued: number;
  failed: number;
}

export interface ActivityState {
  entries: ActivityEntry[];
  more: boolean;
  loading: boolean;
  /** Something changed since this was loaded: the next screen visit reloads it. */
  stale: boolean;
  error: ApiErrorCode | null;
}

const MAX_BATCH = 50;
const EMPTY_ACTIVITY: ActivityState = { entries: [], more: false, loading: false, stale: true, error: null };

const errorCode = (e: unknown): ApiErrorCode => (isApiError(e) ? e.code : 'SERVER');

export class DataStore {
  private userId: string | null = null;
  private server = new Map<string, GroupSnapshot>();
  private order: string[] = [];
  private ops: PendingOp[] = [];
  private view = new Map<string, GroupSnapshot>();
  /** Entities shown before the server confirmed them, with why they're pending. */
  private pendingEntities = new Map<string, OpStatus>();
  private activity = new Map<string, ActivityState>();
  private status: DataStatus = {
    ready: false,
    loadedFromServer: false,
    refreshing: false,
    lastRefreshAt: null,
    error: null,
    queued: 0,
    failed: 0,
  };
  private version = 0;
  private listeners = new Set<() => void>();
  private refreshedListeners = new Set<() => void>();
  private refreshAllRun: Promise<ApiErrorCode | null> | null = null;
  private groupRuns = new Map<string, Promise<void>>();
  private flushRun: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: DataStoreDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => globalThis.crypto.randomUUID());
  }

  // ── Subscription ─────────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  /** Called after every full refresh from the server (push registration, reminders, …). */
  onRefreshed(listener: () => void): () => void {
    this.refreshedListeners.add(listener);
    return () => {
      this.refreshedListeners.delete(listener);
    };
  }

  private emit(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // ── Reads (synchronous, from memory) ─────────────────────────────────

  getUserId(): string | null {
    return this.userId;
  }

  /** The user id to plan with: the account, or a stand-in before the first sign-in. */
  planningUserId(): string {
    return this.userId ?? PENDING_USER;
  }

  group(groupId: string): GroupSnapshot | null {
    const s = this.view.get(groupId.toLowerCase());
    return s && s.group.deletedAt === null ? s : null;
  }

  /** My groups as shown: ones created on this device and not confirmed yet first, then the server's order. */
  groups(): GroupSnapshot[] {
    const known = new Set(this.order);
    const local = [...this.view.keys()].filter((id) => !known.has(id));
    return [...local, ...this.order].map((id) => this.view.get(id)).filter((s): s is GroupSnapshot => !!s && s.group.deletedAt === null);
  }

  /** Why an expense, payment, member or group isn't on the server yet, or null when it is. */
  pendingStatus(entityId: string): OpStatus | null {
    return this.pendingEntities.get(entityId.toLowerCase()) ?? null;
  }

  /** Changes the server refused or that wait in the queue (all groups, or one). */
  pendingOps(groupId?: string): readonly PendingOp[] {
    return groupId ? this.ops.filter((o) => o.groupId === groupId.toLowerCase()) : this.ops;
  }

  getStatus(): DataStatus {
    return this.status;
  }

  activityOf(scope: string | null): ActivityState {
    return this.activity.get(scope ?? '*') ?? EMPTY_ACTIVITY;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Load the cache and the queue saved on this device. Call once at startup. */
  hydrate(): void {
    let saved: SavedState | null = null;
    try {
      saved = this.deps.persistence?.load() ?? null;
    } catch {
      saved = null; // a broken cache is only a slower start
    }
    if (saved) {
      this.userId = saved.userId;
      this.order = saved.order;
      this.server = new Map(saved.groups.map((g) => [g.group.id, g]));
      // Sends that were cut off by the app closing go back to the queue.
      this.ops = saved.ops.map((o) => (o.status === 'sending' ? { ...o, status: 'queued' } : o));
    }
    this.status = { ...this.status, ready: true };
    this.recompute();
  }

  /**
   * The signed-in (or anonymous) account. A different account than the cached one clears the
   * cache: one person's groups never show under another's account.
   */
  setUser(userId: string | null): void {
    const next = userId?.toLowerCase() ?? null;
    if (next === this.userId) return;
    const switched = this.userId !== null && next !== null && this.userId !== PENDING_USER;
    this.userId = next;
    if (switched || next === null) {
      this.server.clear();
      this.order = [];
      this.activity.clear();
      this.status = { ...this.status, loadedFromServer: false, lastRefreshAt: null };
      this.deps.persistence?.clearGroups();
    }
    this.deps.persistence?.saveMeta({ userId: this.userId, order: this.order });
    this.recompute();
  }

  // ── Refresh from the server ──────────────────────────────────────────

  private canTalkToServer(): boolean {
    return this.userId !== null && this.userId !== PENDING_USER && (this.deps.network?.isOnline() ?? true);
  }

  /** Every group I'm in; unchanged ones cost a few bytes. Concurrent calls share one request. */
  refreshAll(): Promise<ApiErrorCode | null> {
    if (!this.canTalkToServer()) return Promise.resolve('OFFLINE');
    this.refreshAllRun ??= (async () => {
      this.setStatus({ refreshing: true });
      try {
        const known = Object.fromEntries([...this.server.values()].map((s) => [s.group.id, s.rev]));
        const listed = await this.deps.api.listGroups(known);
        const ids = new Set(listed.map((g) => g.id));
        for (const id of [...this.server.keys()]) {
          if (!ids.has(id)) this.dropGroup(id);
        }
        for (const g of listed) {
          if (g.snapshot) this.storeGroup(g.snapshot);
        }
        this.order = listed.map((g) => g.id);
        this.deps.persistence?.saveMeta({ userId: this.userId, order: this.order });
        this.markActivityStale();
        this.setStatus({ refreshing: false, loadedFromServer: true, lastRefreshAt: this.now(), error: null }, false);
        this.recompute();
        this.refreshedListeners.forEach((l) => l());
        return null;
      } catch (e) {
        const code = errorCode(e);
        this.setStatus({ refreshing: false, error: code });
        return code;
      } finally {
        this.refreshAllRun = null;
      }
    })();
    return this.refreshAllRun;
  }

  /** One group (after a change signal or a write). Gone for me = dropped from the cache. */
  refreshGroup(groupId: string): Promise<void> {
    const id = groupId.toLowerCase();
    if (!this.canTalkToServer()) return Promise.resolve();
    const running = this.groupRuns.get(id);
    if (running) return running;
    const run = (async () => {
      try {
        const res = await this.deps.api.getGroup(id, this.server.get(id)?.rev ?? null);
        if (res.status === 'OK') {
          this.storeGroup(res.snapshot);
          if (!this.order.includes(id)) this.order = [id, ...this.order];
          this.deps.persistence?.saveMeta({ userId: this.userId, order: this.order });
          this.markActivityStale(id);
        } else if (res.status === 'FORBIDDEN') {
          this.dropGroup(id);
        }
        this.recompute();
      } catch {
        // Kept as is: the next open, pull or signal tries again.
      } finally {
        this.groupRuns.delete(id);
      }
    })();
    this.groupRuns.set(id, run);
    return run;
  }

  private storeGroup(snapshot: GroupSnapshot): void {
    this.server.set(snapshot.group.id, snapshot);
    this.deps.persistence?.saveGroup(snapshot);
  }

  private dropGroup(groupId: string): void {
    this.server.delete(groupId);
    this.order = this.order.filter((id) => id !== groupId);
    this.activity.delete(groupId);
    this.deps.persistence?.removeGroup(groupId);
  }

  // ── Writes ───────────────────────────────────────────────────────────

  /**
   * Plan, show, send. Resolves once the server answered (or the change was queued offline).
   * Validation errors come back before anything is shown.
   */
  async run<K extends CommandOp>(op: K, input: CommandInputs[K]): Promise<RunResult<K>> {
    const cmd = { op, input } as Command;
    const groupId = commandGroupId(cmd);
    const at = this.now();
    const planned = planCommand(this.view.get(groupId) ?? null, this.planContext(at, 'check'), cmd);
    if (!planned.ok) return { ok: false, error: planned.error as CommandError<K> };
    const entityId = planned.plan.entityId;
    const total = Object.values(planned.plan.batch).reduce((n, rows) => n + rows.length, 0);
    if (total === 0) return { ok: true, entityId, queued: false }; // nothing changed

    const pending: PendingOp = { requestId: this.newId(), groupId, cmd, at, status: 'sending' };
    this.ops = [...this.ops, pending];
    // Saved before sending: if the app closes mid-send, the next launch sends it again (the
    // request id makes that safe).
    if (isQueueable(op)) this.deps.persistence?.putOp(pending);
    this.recompute();

    if (!this.canTalkToServer()) return this.queueOrFail(pending, entityId) as RunResult<K>;

    // Anything already waiting goes first: this change may build on it.
    if (this.ops.some((o) => o.status === 'queued')) await this.flush();

    try {
      const [result] = await this.deps.api.run([this.toRequest(pending)], this.deps.origin?.());
      return (await this.settle(pending, result!, entityId)) as RunResult<K>;
    } catch (e) {
      const code = errorCode(e);
      if (code === 'OFFLINE') return this.queueOrFail(pending, entityId) as RunResult<K>;
      this.removeOp(pending.requestId);
      return { ok: false, error: { code } as Exclude<CommandFailure, CommandError> };
    }
  }

  private queueOrFail(op: PendingOp, entityId: string): RunResult {
    if (this.deps.persistence && isQueueable(op.cmd.op)) {
      this.updateOp({ ...op, status: 'queued' });
      return { ok: true, entityId, queued: true };
    }
    this.removeOp(op.requestId);
    return { ok: false, error: { code: 'OFFLINE' } };
  }

  /** Apply a server answer to a sent op. */
  private async settle(op: PendingOp, result: CommandResult, entityId: string): Promise<RunResult> {
    if (result.ok) {
      // Keep showing the change until the refetched snapshot has it: no flicker.
      await this.refreshGroup(op.groupId);
      this.removeOp(op.requestId);
      return { ok: true, entityId, queued: false };
    }
    this.removeOp(op.requestId);
    if (result.error.code === 'STALE' || result.error.code === 'NOT_FOUND') void this.refreshGroup(op.groupId);
    return { ok: false, error: result.error };
  }

  /**
   * Send what waits in the queue, oldest first. Stops at the first sign of no connection; a change
   * the server refuses is kept as 'failed' for the person to fix or discard, never dropped silently.
   */
  flush(): Promise<void> {
    if (!this.canTalkToServer()) return Promise.resolve();
    this.flushRun ??= (async () => {
      try {
        for (;;) {
          const batch = this.ops.filter((o) => o.status === 'queued').slice(0, MAX_BATCH);
          if (batch.length === 0) return;
          batch.forEach((o) => this.updateOp({ ...o, status: 'sending' }, false));
          this.recompute();
          let results: CommandResult[];
          try {
            results = await this.deps.api.run(batch.map((o) => this.toRequest(o)), this.deps.origin?.());
          } catch (e) {
            batch.forEach((o) => this.updateOp({ ...o, status: 'queued' }, false));
            this.recompute();
            if (errorCode(e) === 'BAD_REQUEST') {
              batch.forEach((o) => this.updateOp({ ...o, status: 'failed', error: { code: 'BAD_REQUEST' } }, false));
              this.recompute();
              continue;
            }
            return; // offline or server trouble: try again on the next reconnect / open
          }
          const touched = new Set<string>();
          results.forEach((r, i) => {
            const op = batch[i]!;
            touched.add(op.groupId);
            if (r.ok) this.removeOp(op.requestId, false);
            else this.updateOp({ ...op, status: 'failed', error: r.error }, false);
          });
          await Promise.all([...touched].map((g) => this.refreshGroup(g)));
          this.recompute();
        }
      } finally {
        this.flushRun = null;
      }
    })();
    return this.flushRun;
  }

  /** A refused queued change: try again as is (after fixing whatever the server objected to). */
  retryOp(requestId: string): void {
    const op = this.ops.find((o) => o.requestId === requestId);
    if (!op) return;
    // A new request id: the server remembers its answer to the old one.
    this.removeOp(requestId, false);
    this.ops = [...this.ops, { ...op, requestId: this.newId(), status: 'queued', error: undefined }];
    this.deps.persistence?.putOp(this.ops.at(-1)!);
    this.recompute();
    void this.flush();
  }

  discardOp(requestId: string): void {
    this.removeOp(requestId);
  }

  private toRequest(op: PendingOp): CommandRequest {
    return { requestId: op.requestId, ...op.cmd } as CommandRequest;
  }

  private updateOp(op: PendingOp, notify = true): void {
    this.ops = this.ops.map((o) => (o.requestId === op.requestId ? op : o));
    if (isQueueable(op.cmd.op)) this.deps.persistence?.putOp(op);
    if (notify) this.recompute();
  }

  private removeOp(requestId: string, notify = true): void {
    this.ops = this.ops.filter((o) => o.requestId !== requestId);
    this.deps.persistence?.deleteOp(requestId);
    if (notify) this.recompute();
  }

  // ── History ──────────────────────────────────────────────────────────

  /** Load the first page (or the next one with `more`). Scope: a group id, or null for all groups. */
  async loadActivity(scope: string | null, options: { more?: boolean } = {}): Promise<void> {
    const key = scope?.toLowerCase() ?? '*';
    const current = this.activity.get(key) ?? EMPTY_ACTIVITY;
    if (current.loading || !this.canTalkToServer()) return;
    if (options.more && !current.more) return;
    this.activity.set(key, { ...current, loading: true });
    this.emit();
    try {
      const last = options.more ? current.entries.at(-1) : null;
      const page = await this.deps.api.listActivity(scope, last ? { createdAt: last.createdAt, id: last.id } : null);
      const entries = options.more ? [...current.entries, ...page.entries] : page.entries;
      this.activity.set(key, { entries, more: page.more, loading: false, stale: false, error: null });
    } catch (e) {
      this.activity.set(key, { ...current, loading: false, error: errorCode(e) });
    }
    this.emit();
  }

  private markActivityStale(groupId?: string): void {
    for (const [key, value] of this.activity) {
      if (!groupId || key === groupId || key === '*') this.activity.set(key, { ...value, stale: true });
    }
  }

  // ── View ─────────────────────────────────────────────────────────────

  private planContext(at: number, salt: string) {
    let n = 0;
    return { userId: this.planningUserId(), now: at, newId: () => `${salt}-${n++}` };
  }

  private recompute(): void {
    const view = new Map(this.server);
    const pending = new Map<string, OpStatus>();
    for (const op of this.ops) {
      if (op.status === 'failed') continue;
      const planned = planCommand(view.get(op.groupId) ?? null, this.planContext(op.at, op.requestId), op.cmd);
      if (!planned.ok) continue; // no longer applies to the group as it is now: the server decides
      const next = applyPlan(view.get(op.groupId) ?? null, planned.plan);
      if (next) view.set(op.groupId, next);
      pending.set(planned.plan.entityId, op.status);
      if (op.cmd.op === 'group.create') pending.set(op.groupId, op.status);
    }
    this.view = view;
    this.pendingEntities = pending;
    this.status = {
      ...this.status,
      queued: this.ops.filter((o) => o.status === 'queued').length,
      failed: this.ops.filter((o) => o.status === 'failed').length,
    };
    this.emit();
  }

  private setStatus(patch: Partial<DataStatus>, notify = true): void {
    this.status = { ...this.status, ...patch };
    if (notify) this.emit();
  }
}
