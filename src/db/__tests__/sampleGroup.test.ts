import { computeBalances } from '@/domain/balances';
import { loadOverview } from '@/features/overview/loadOverview';
import { addExpenseGroups } from '@/features/overview/openAddExpense';
import { collectPushBatch } from '@/sync/engine';
import { countPendingChanges } from '@/sync/issueActions';

import { createExpense } from '../repositories/expenses';
import { activeGroupsQuery, createGroup, renameGroup } from '../repositories/groups';
import { loadGroupLedger } from '../repositories/ledger';
import { activeMembersQuery } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import {
  isSampleGroup,
  removeSampleGroup,
  SAMPLE_EXPENSES,
  SAMPLE_GROUP_NAME,
  sampleGroupIds,
  seedSampleGroupIfNew,
} from '../repositories/sampleGroup';
import { expenses, groups, members, settlements } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;
let me: string;

beforeEach(() => {
  t = createTestContext();
  me = getOrCreateDeviceUserId(t.ctx);
});
afterEach(() => t.close());

const seed = () => seedSampleGroupIfNew(t.ctx, { deviceUserId: me, today: '2026-10-18' });

function balancesByName(groupId: string): Record<string, number> {
  const ledger = loadGroupLedger(t.ctx.db, groupId);
  const { balances } = computeBalances(ledger.expenses, ledger.settlements);
  return Object.fromEntries(
    activeMembersQuery(t.ctx.db, groupId)
      .all()
      .map((m) => [m.displayName, balances.get(m.id) ?? 0]),
  );
}

function realGroup(name = 'Flat') {
  const r = createGroup(t.ctx, { name, selfName: 'Asha', otherMemberNames: ['Ravi'], deviceUserId: me });
  if (!r.ok) throw new Error('group');
  return r.value;
}

describe('seedSampleGroupIfNew', () => {
  it('creates the example group once, with every expense and a payment', () => {
    const groupId = seed();
    expect(groupId).not.toBeNull();
    expect(isSampleGroup(t.ctx.db, groupId!)).toBe(true);

    const group = activeGroupsQuery(t.ctx.db).all();
    expect(group.map((g) => g.name)).toEqual([SAMPLE_GROUP_NAME]);
    expect(group[0]!.currency).toBe('INR');
    expect(t.ctx.db.select().from(members).all().map((m) => m.displayName).sort()).toEqual(
      ['Aman', 'Priya', 'Rahul', 'You'],
    );
    expect(t.ctx.db.select().from(expenses).all()).toHaveLength(SAMPLE_EXPENSES.length);
    expect(t.ctx.db.select().from(settlements).all()).toHaveLength(1);

    // You're owed ₹4,000; Aman is square after paying you back.
    expect(balancesByName(groupId!)).toEqual({ You: 400000, Rahul: 170000, Priya: -570000, Aman: 0 });

    expect(seed()).toBeNull();
    expect(activeGroupsQuery(t.ctx.db).all()).toHaveLength(1);
  });

  it('dates expenses relative to today', () => {
    seed();
    const dates = t.ctx.db.select({ d: expenses.expenseDate }).from(expenses).all().map((r) => r.d);
    expect(dates).toContain('2026-10-12');
    expect(dates.every((d) => d < '2026-10-18')).toBe(true);
  });

  it('is skipped for phones that already have groups, and never offered later', () => {
    realGroup();
    expect(seed()).toBeNull();
    expect(seed()).toBeNull();
    expect(sampleGroupIds(t.ctx.db).size).toBe(0);
    expect(activeGroupsQuery(t.ctx.db).all().map((g) => g.name)).toEqual(['Flat']);
  });
});

describe('the example never syncs', () => {
  it('has nothing to push, even after edits', () => {
    const groupId = seed()!;
    expect(collectPushBatch(t.ctx)).toBeNull();
    expect(countPendingChanges(t.ctx)).toBe(0);

    const self = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'You')!.id;
    renameGroup(t.ctx, { groupId, name: 'Goa', actorMemberId: self });
    createExpense(t.ctx, {
      groupId,
      description: 'Ice cream',
      amountPaise: 20000,
      expenseDate: '2026-10-18',
      payers: [{ memberId: self, amountPaise: 20000 }],
      splitInput: { type: 'equal', memberIds: [self] },
      actorMemberId: self,
    });
    expect(collectPushBatch(t.ctx)).toBeNull();
    expect(countPendingChanges(t.ctx)).toBe(0);
  });

  it('pushes real groups alongside it, without any example rows', () => {
    const sampleId = seed()!;
    const real = realGroup();
    const batch = collectPushBatch(t.ctx)!.batch;
    expect(batch.groups.map((g) => g.id)).toEqual([real.groupId]);
    const rowGroupIds = [...batch.members, ...batch.expenses, ...batch.settlements, ...batch.activity].map(
      (r) => (r as { group_id: string }).group_id,
    );
    expect(rowGroupIds.length).toBeGreaterThan(0);
    expect(rowGroupIds).not.toContain(sampleId);
    expect(countPendingChanges(t.ctx)).toBe(batch.groups.length + batch.members.length + batch.activity.length);
  });
});

describe('removeSampleGroup', () => {
  it('deletes the example and everything in it', () => {
    const groupId = seed()!;
    expect(removeSampleGroup(t.ctx, groupId)).toEqual({ ok: true, value: { receiptIds: [] } });
    expect(t.ctx.db.select().from(groups).all()).toHaveLength(0);
    expect(t.ctx.db.select().from(members).all()).toHaveLength(0);
    expect(t.ctx.db.select().from(expenses).all()).toHaveLength(0);
    expect(sampleGroupIds(t.ctx.db).size).toBe(0);
    // Gone for good: not re-created on the next launch.
    expect(seed()).toBeNull();
  });

  it('refuses real groups', () => {
    seed();
    const real = realGroup();
    expect(removeSampleGroup(t.ctx, real.groupId)).toEqual({ ok: false, error: { code: 'NOT_SAMPLE' } });
  });
});

describe('Home totals', () => {
  it('count the example while it is the only group', () => {
    seed();
    const overview = loadOverview(t.ctx.db, me, '2026-10-18');
    expect(overview.groups[0]!.sample).toBe(true);
    expect(overview.totals).toEqual([{ currency: 'INR', owedToMe: 400000, iOwe: 0, net: 400000 }]);
    expect(overview.transfers.length).toBeGreaterThan(0);
    expect(loadOverview(t.ctx.db, me, '2026-10-18', 'never').totals).toEqual([]);
  });

  it('leave it out once a real group exists', () => {
    seed();
    realGroup();
    const overview = loadOverview(t.ctx.db, me, '2026-10-18');
    expect(overview.groups).toHaveLength(2);
    expect(overview.totals).toEqual([]);
    expect(overview.transfers).toEqual([]);
  });

  it('"+" skips the example once a real group exists', () => {
    const sampleId = seed()!;
    const all = activeGroupsQuery(t.ctx.db).all();
    expect(addExpenseGroups(all, sampleGroupIds(t.ctx.db)).map((g) => g.id)).toEqual([sampleId]);
    const real = realGroup();
    const both = activeGroupsQuery(t.ctx.db).all();
    expect(addExpenseGroups(both, sampleGroupIds(t.ctx.db)).map((g) => g.id)).toEqual([real.groupId]);
  });
});
