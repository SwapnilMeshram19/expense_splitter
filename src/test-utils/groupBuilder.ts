/**
 * Builds realistic group snapshots for tests by running real commands through the shared planner
 * (the same code the server runs), instead of hand-writing rows.
 */
import { applyPlan, planActivity, planCommand, type CommandInputs, type CommandOp } from '@/domain/commands';
import type { ActivityEntry, GroupSnapshot } from '@/domain/model';

let counter = 0;
const uuid = () => {
  counter++;
  const hex = counter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};

export interface TestGroup {
  groupId: string;
  userId: string;
  /** My member id. */
  me: string;
  /** Member id by display name. */
  member(name: string): string;
  snapshot(): GroupSnapshot;
  /** History, newest first. */
  activity(): ActivityEntry[];
  /** Run a command as `asUser` (default: me); throws on a planner error. Returns the entity id. */
  run<K extends CommandOp>(op: K, input: Omit<CommandInputs[K], 'groupId'>, asUser?: string): string;
  /** Like run, but returns the planner's error instead of throwing. */
  tryRun<K extends CommandOp>(op: K, input: Omit<CommandInputs[K], 'groupId'>, asUser?: string): { ok: true; id: string } | { ok: false; error: unknown };
  /** Move the clock forward (ms). */
  advance(ms: number): void;
  now(): number;
  /** Version the server would hold for an entity (for update commands). */
  versionOf(id: string): number;
  newId(): string;
}

export function testGroup(options: { name?: string; me?: string; others?: string[]; currency?: string; userId?: string; now?: number } = {}): TestGroup {
  const userId = options.userId ?? uuid();
  const groupId = uuid();
  const meId = uuid();
  let clock = options.now ?? Date.UTC(2026, 9, 1, 12);
  let snapshot: GroupSnapshot | null = null;
  const log: ActivityEntry[] = [];

  const execute = <K extends CommandOp>(op: K, input: CommandInputs[K], asUser: string) => {
    const planned = planCommand(snapshot, { userId: asUser, now: clock, newId: uuid }, { op, input });
    if (!planned.ok) return planned;
    snapshot = applyPlan(snapshot, planned.plan);
    log.unshift(...planActivity(planned.plan).reverse());
    clock += 1;
    return planned;
  };

  const created = execute(
    'group.create',
    {
      id: groupId,
      name: options.name ?? 'Goa',
      myMemberId: meId,
      myName: options.me ?? 'Asha',
      members: (options.others ?? []).map((name) => ({ id: uuid(), name })),
      currency: options.currency,
    },
    userId,
  );
  if (!created.ok) throw new Error(`testGroup: ${JSON.stringify(created.error)}`);

  const group: TestGroup = {
    groupId,
    userId,
    me: meId,
    member(name) {
      const m = snapshot!.members.find((x) => x.displayName === name);
      if (!m) throw new Error(`no member ${name}`);
      return m.id;
    },
    snapshot: () => snapshot!,
    activity: () => [...log],
    tryRun(op, input, asUser = userId) {
      const r = execute(op, { groupId, ...input } as CommandInputs[typeof op], asUser);
      return r.ok ? { ok: true, id: r.plan.entityId } : { ok: false, error: r.error };
    },
    run(op, input, asUser = userId) {
      const r = group.tryRun(op, input, asUser);
      if (!r.ok) throw new Error(`${op}: ${JSON.stringify(r.error)}`);
      return r.id;
    },
    advance(ms) {
      clock += ms;
    },
    now: () => clock,
    versionOf(id) {
      const s = snapshot!;
      const row =
        s.group.id === id
          ? s.group
          : (s.members.find((m) => m.id === id) ?? s.expenses.find((e) => e.id === id) ?? s.settlements.find((x) => x.id === id) ?? s.rules.find((r) => r.id === id));
      if (!row) throw new Error(`no row ${id}`);
      return row.version;
    },
    newId: uuid,
  };
  return group;
}

/** A user id that isn't in any test group. */
export const otherUserId = (): string => uuid();
