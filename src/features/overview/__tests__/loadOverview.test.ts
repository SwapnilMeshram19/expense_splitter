import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense } from '@/db/repositories/expenses';
import { createGroup } from '@/db/repositories/groups';
import { activeMembersQuery } from '@/db/repositories/members';
import { getOrCreateDeviceUserId, setSetting } from '@/db/repositories/profile';
import { recordSettlement } from '@/db/repositories/settlements';
import { loadRecentActivity } from '@/features/activity/loadRecentActivity';
import { SYNC_LOST_GROUPS_KEY } from '@/sync/engine';

import { loadOverview } from '../loadOverview';
import { addExpenseTarget, editableGroups } from '../openAddExpense';

let t: TestContext;
let deviceUserId: string;

beforeEach(() => {
  t = createTestContext();
  deviceUserId = getOrCreateDeviceUserId(t.ctx);
});

afterEach(() => t.close());

function group(name: string, others: string[], currency?: string) {
  const created = createGroup(t.ctx, {
    name,
    selfName: 'Asha',
    otherMemberNames: others,
    deviceUserId,
    currency,
  });
  if (!created.ok) throw new Error('createGroup failed');
  t.advance(1000);
  const ids = new Map(activeMembersQuery(t.ctx.db, created.value.groupId).all().map((m) => [m.displayName, m.id]));
  return { groupId: created.value.groupId, me: created.value.selfMemberId, id: (n: string) => ids.get(n)! };
}

function expense(groupId: string, actor: string, payer: string, amountPaise: number, memberIds: string[]) {
  const result = createExpense(t.ctx, {
    groupId,
    description: 'Expense',
    amountPaise,
    expenseDate: '2026-10-01',
    payers: [{ memberId: payer, amountPaise }],
    splitInput: { type: 'equal', memberIds },
    actorMemberId: actor,
  });
  if (!result.ok) throw new Error('createExpense failed');
  t.advance(1000);
}

describe('loadOverview', () => {
  it('is empty without groups', () => {
    expect(loadOverview(t.ctx.db, deviceUserId)).toEqual({ groups: [], totals: [], transfers: [] });
  });

  it('nets per group, sums across groups and lists my transfers', () => {
    const goa = group('Goa', ['Rahul', 'Priya']);
    // I paid ₹900 for three → Rahul and Priya owe me ₹300 each.
    expense(goa.groupId, goa.me, goa.me, 90000, [goa.me, goa.id('Rahul'), goa.id('Priya')]);

    const flat = group('Flat', ['Amit']);
    // Amit paid ₹1,001 for two → I owe ₹500.50 (paise split is the domain's job; total stays exact).
    expense(flat.groupId, flat.me, flat.id('Amit'), 100100, [flat.me, flat.id('Amit')]);

    const overview = loadOverview(t.ctx.db, deviceUserId);
    const myFlatDebt = -overview.groups.find((g) => g.group.id === flat.groupId)!.myBalance;

    expect(overview.totals).toEqual([
      { currency: 'INR', owedToMe: 60000, iOwe: myFlatDebt, net: 60000 - myFlatDebt },
    ]);
    expect(overview.groups.map((g) => g.group.name)).toEqual(['Flat', 'Goa']); // most recently updated first

    const pay = overview.transfers.filter((x) => x.direction === 'pay');
    const receive = overview.transfers.filter((x) => x.direction === 'receive');
    expect(pay).toEqual([
      expect.objectContaining({ groupName: 'Flat', counterpartyName: 'Amit', amountPaise: myFlatDebt, meId: flat.me }),
    ]);
    expect(receive.map((x) => [x.counterpartyName, x.amountPaise])).toEqual([
      ['Priya', 30000],
      ['Rahul', 30000],
    ]);
    // My transfers add up to my balances exactly, so the Settle tab totals match Home.
    expect(receive.reduce((s, x) => s + x.amountPaise, 0)).toBe(overview.totals[0]!.owedToMe);
    expect(pay.reduce((s, x) => s + x.amountPaise, 0)).toBe(overview.totals[0]!.iOwe);
  });

  it('drops settled-up debts after a settlement', () => {
    const goa = group('Goa', ['Rahul']);
    expense(goa.groupId, goa.me, goa.me, 60000, [goa.me, goa.id('Rahul')]);
    const settled = recordSettlement(t.ctx, {
      groupId: goa.groupId,
      fromMemberId: goa.id('Rahul'),
      toMemberId: goa.me,
      amountPaise: 30000,
      method: 'cash',
      actorMemberId: goa.me,
    });
    expect(settled.ok).toBe(true);

    const overview = loadOverview(t.ctx.db, deviceUserId);
    expect(overview.transfers).toEqual([]);
    expect(overview.totals).toEqual([]);
    expect(overview.groups[0]!.myBalance).toBe(0);
  });

  it('marks lost groups read-only but still counts their balances', () => {
    const goa = group('Goa', ['Rahul']);
    expense(goa.groupId, goa.me, goa.me, 60000, [goa.me, goa.id('Rahul')]);
    setSetting(t.ctx, SYNC_LOST_GROUPS_KEY, JSON.stringify([goa.groupId]));

    const overview = loadOverview(t.ctx.db, deviceUserId);
    expect(overview.groups[0]).toEqual(expect.objectContaining({ lost: true, canEdit: false }));
    expect(overview.transfers[0]).toEqual(expect.objectContaining({ canEdit: false, amountPaise: 30000 }));
    expect(overview.totals[0]!.owedToMe).toBe(30000);
  });

  it('keeps totals per currency and never adds amounts across currencies', () => {
    const goa = group('Goa', ['Rahul']);
    expense(goa.groupId, goa.me, goa.me, 60000, [goa.me, goa.id('Rahul')]); // Rahul owes me ₹300
    const bali = group('Bali', ['Priya'], 'IDR');
    // Priya paid Rp1,000,000.00 for two → I owe Rp500,000.00 (IDR has 2 minor digits).
    expense(bali.groupId, bali.me, bali.id('Priya'), 100_000_000, [bali.me, bali.id('Priya')]);
    const tokyo = group('Tokyo', ['Amit'], 'JPY');
    expense(tokyo.groupId, tokyo.me, tokyo.me, 3001, [tokyo.me, tokyo.id('Amit')]); // ¥3,001 for two

    const overview = loadOverview(t.ctx.db, deviceUserId);
    const amitOwes = overview.transfers.find((x) => x.currency === 'JPY')!.amountPaise;
    expect([1500, 1501]).toContain(amitOwes); // ¥ has no minor unit: whole yen only
    expect(overview.totals).toEqual([
      { currency: 'INR', owedToMe: 30000, iOwe: 0, net: 30000 },
      { currency: 'IDR', owedToMe: 0, iOwe: 50_000_000, net: -50_000_000 },
      { currency: 'JPY', owedToMe: amitOwes, iOwe: 0, net: amitOwes },
    ]);
    // INR first, then by currency code; each transfer carries its group's currency.
    expect(overview.transfers.map((x) => [x.currency, x.counterpartyName, x.direction])).toEqual([
      ['INR', 'Rahul', 'receive'],
      ['IDR', 'Priya', 'pay'],
      ['JPY', 'Amit', 'receive'],
    ]);
  });
});

describe('add expense target', () => {
  it('creates a group first, opens the only group, or asks', () => {
    expect(addExpenseTarget([])).toEqual({ kind: 'createGroup' });
    const goa = group('Goa', ['Rahul']);
    expect(addExpenseTarget(editableGroups(t.ctx.db, deviceUserId))).toEqual({ kind: 'group', groupId: goa.groupId });
    group('Flat', ['Amit']);
    expect(addExpenseTarget(editableGroups(t.ctx.db, deviceUserId))).toEqual({ kind: 'pick' });
  });

  it('never offers a group this phone lost access to', () => {
    const goa = group('Goa', ['Rahul']);
    const flat = group('Flat', ['Amit']);
    setSetting(t.ctx, SYNC_LOST_GROUPS_KEY, JSON.stringify([goa.groupId]));
    expect(editableGroups(t.ctx.db, deviceUserId).map((g) => g.id)).toEqual([flat.groupId]);
  });
});

describe('loadRecentActivity', () => {
  it('merges activity across groups, newest first, with group names', () => {
    const goa = group('Goa', ['Rahul']);
    const flat = group('Flat', ['Amit']);
    expense(goa.groupId, goa.me, goa.me, 1000, [goa.me, goa.id('Rahul')]);
    expense(flat.groupId, flat.me, flat.me, 2000, [flat.me, flat.id('Amit')]);

    const items = loadRecentActivity(t.ctx.db, deviceUserId);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.groupName).toBe('Flat');
    expect(items.map((i) => i.createdAt)).toEqual([...items.map((i) => i.createdAt)].sort((a, b) => b - a));
    expect(items[0]!.title.startsWith('You')).toBe(true);
    expect(loadRecentActivity(t.ctx.db, deviceUserId, 1)).toHaveLength(1);
  });
});
