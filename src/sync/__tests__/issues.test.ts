import { eq } from 'drizzle-orm';

import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense } from '@/db/repositories/expenses';
import { createGroup, renameGroup } from '@/db/repositories/groups';
import { activeMembersQuery } from '@/db/repositories/members';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { groups } from '@/db/schema';

import { formatIsoDate, rejectionReason, summarizeRow } from '../describeIssue';
import { applyPushResult, collectPushBatch, getSyncIssues } from '../engine';
import {
  countPendingChanges,
  discardLocalChange,
  getRefetchGroupIds,
  loadIssueViews,
  retryRejectedChange,
} from '../issueActions';
import { runSync, type SyncTransport } from '../runSync';
import { groupToWire, type PullResult, type PushBatch, type PushResult } from '../wire';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Goa',
    selfName: 'Asha',
    otherMemberNames: ['Mom'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const { groupId, selfMemberId: me } = created.value;
  const mom = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Mom')!.id;
  const expense = createExpense(t.ctx, {
    groupId,
    description: 'Dinner',
    amountPaise: 90000,
    expenseDate: '2026-10-01',
    payers: [{ memberId: me, amountPaise: 90000 }],
    splitInput: { type: 'equal', memberIds: [me, mom] },
    actorMemberId: me,
  });
  if (!expense.ok) throw new Error(JSON.stringify(expense.error));
  return { groupId, me, mom };
}

const ackAll = (batch: PushBatch): PushResult => ({
  applied: [
    ...batch.groups.map((r) => ({ table: 'groups' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.members.map((r) => ({ table: 'members' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.expenses.map((r) => ({ table: 'expenses' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.settlements.map((r) => ({ table: 'settlements' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.activity.map((r) => ({ table: 'activity' as const, id: r.id, version: null })),
  ],
  conflicts: [],
  rejected: [],
});

const pull = (overrides: Partial<PullResult> = {}): PullResult => ({
  cursor: '100',
  group_ids: [],
  groups: [],
  members: [],
  expenses: [],
  settlements: [],
  activity: [],
  ...overrides,
});

const groupRow = (id: string) => t.ctx.db.select().from(groups).where(eq(groups.id, id)).get()!;

/** Synced group, then a local rename that the server rejects. */
function rejectedRename() {
  const g = setup();
  const first = collectPushBatch(t.ctx)!;
  applyPushResult(t.ctx, first, ackAll(first.batch));
  renameGroup(t.ctx, { groupId: g.groupId, name: 'Renamed here', actorMemberId: g.me });
  const second = collectPushBatch(t.ctx)!;
  applyPushResult(t.ctx, second, {
    applied: ackAll(second.batch).applied.filter((o) => o.table !== 'groups'),
    conflicts: [],
    rejected: [{ table: 'groups', id: g.groupId, code: 'FORBIDDEN' }],
  });
  return g;
}

describe('describeIssue', () => {
  it('formats dates without Intl', () => {
    expect(formatIsoDate('2026-10-01')).toBe('1 Oct 2026');
    expect(formatIsoDate('bad')).toBe('bad');
  });

  it('summarizes an expense with amounts and names', () => {
    const names: Record<string, string> = { a: 'Asha', m: 'Mom' };
    const lines = summarizeRow(
      'expenses',
      {
        description: 'Dinner',
        amount_paise: 123456,
        expense_date: '2026-10-01',
        deleted_at: null,
        payers: [{ member_id: 'a', amount_paise: 123456 }],
        shares: [
          { member_id: 'a', amount_paise: 61728 },
          { member_id: 'm', amount_paise: 61728 },
        ],
      },
      (id) => names[id] ?? 'someone',
    );
    expect(lines).toEqual([
      'Dinner · ₹1,234.56',
      'Date: 1 Oct 2026',
      'Paid by Asha ₹1,234.56',
      'Split: Asha ₹617.28, Mom ₹617.28',
    ]);
  });

  it('marks deleted rows and missing rows', () => {
    expect(summarizeRow('groups', { name: 'Goa', deleted_at: 5 }, () => '')).toEqual(['Deleted', 'Name: Goa']);
    expect(summarizeRow('groups', null, () => '')).toEqual(['Not on this phone']);
  });

  it('explains rejections in plain language', () => {
    expect(rejectionReason('FORBIDDEN')).toMatch(/access/);
    expect(rejectionReason('SHARES_MISMATCH')).toMatch(/update the app/);
    expect(rejectionReason(undefined)).toMatch(/couldn’t accept/);
  });
});

describe('issue actions', () => {
  it('counts pending changes across tables', () => {
    setup();
    expect(countPendingChanges(t.ctx)).toBe(6); // group, 2 members, expense, 2 history entries
    const collected = collectPushBatch(t.ctx)!;
    applyPushResult(t.ctx, collected, ackAll(collected.batch));
    expect(countPendingChanges(t.ctx)).toBe(0);
  });

  it('builds a view for a rejected change, with the discard option for server-known rows', () => {
    rejectedRename();
    const [view] = loadIssueViews(t.ctx);
    expect(view).toMatchObject({ title: 'Group “Renamed here”', canDiscard: true });
    expect(view!.reason).toMatch(/access/);
  });

  it('retries a rejected change by sending it again', () => {
    const g = rejectedRename();
    expect(collectPushBatch(t.ctx)).toBeNull();

    expect(retryRejectedChange(t.ctx, 'groups', g.groupId).ok).toBe(true);

    expect(getSyncIssues(t.ctx)).toHaveLength(0);
    expect(collectPushBatch(t.ctx)!.batch.groups[0]).toMatchObject({ name: 'Renamed here', base_version: 1 });
  });

  it('refuses to discard a change the server has never seen', () => {
    const g = setup();
    const collected = collectPushBatch(t.ctx)!;
    applyPushResult(t.ctx, collected, {
      applied: [],
      conflicts: [],
      rejected: [{ table: 'groups', id: g.groupId, code: 'NOT_A_MEMBER' }],
    });

    expect(discardLocalChange(t.ctx, 'groups', g.groupId)).toEqual({ ok: false, error: { code: 'NOT_ON_SERVER' } });
  });

  it('discards a rejected change and restores the server copy on the next sync', async () => {
    const g = rejectedRename();

    expect(discardLocalChange(t.ctx, 'groups', g.groupId).ok).toBe(true);
    expect(groupRow(g.groupId)).toMatchObject({ dirty: false, version: 0 });
    expect(getRefetchGroupIds(t.ctx)).toEqual([g.groupId]);

    const serverCopy = { ...groupToWire(groupRow(g.groupId)), name: 'Goa', version: 3 };
    const pulls: [string | null, string[]][] = [];
    const transport: SyncTransport = {
      push: async (batch) => ackAll(batch),
      pull: async (cursor, full) => {
        pulls.push([cursor, full]);
        return full.length === 0
          ? pull({ group_ids: [g.groupId] })
          : pull({ cursor: '101', group_ids: [g.groupId], groups: [serverCopy] });
      },
    };

    await runSync(t.ctx, transport);

    expect(pulls[1]).toEqual(['100', [g.groupId]]);
    expect(groupRow(g.groupId)).toMatchObject({ name: 'Goa', version: 3, dirty: false });
    expect(getRefetchGroupIds(t.ctx)).toEqual([]);
        expect(rejectionReason('INVALID', '23V01')).toMatch(/only they can change their UPI ID/);
  });
});