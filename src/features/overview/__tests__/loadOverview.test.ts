import type { GroupSnapshot } from '@/domain/model';
import { loadRecentActivity } from '@/features/activity/loadRecentActivity';
import { otherUserId, testGroup, type TestGroup } from '@/test-utils/groupBuilder';

import { loadOverview } from '../loadOverview';
import { addExpenseTarget, editableGroups } from '../openAddExpense';

let deviceUserId: string;
let groups: TestGroup[];
let clock: number;

beforeEach(() => {
  deviceUserId = otherUserId();
  groups = [];
  clock = Date.UTC(2026, 9, 1, 12);
});

/** Newest group first, like the store lists them (most recently updated first). */
const snapshots = (): GroupSnapshot[] =>
  [...groups].sort((a, b) => b.snapshot().group.updatedAt - a.snapshot().group.updatedAt).map((g) => g.snapshot());

function group(name: string, others: string[], currency?: string) {
  clock += 1000;
  const g = testGroup({ name, me: 'Asha', others, currency, userId: deviceUserId, now: clock });
  groups.push(g);
  return { groupId: g.groupId, me: g.me, id: (n: string) => g.member(n), g };
}

function expense(groupId: string, _actor: string, payer: string, amountPaise: number, memberIds: string[]) {
  const g = groups.find((x) => x.groupId === groupId)!;
  g.run('expense.add', {
    id: g.newId(),
    description: 'Expense',
    amountPaise,
    expenseDate: '2026-10-01',
    payers: [{ memberId: payer, amountPaise }],
    splitInput: { type: 'equal', memberIds },
  });
  g.advance(1000);
}

describe('loadOverview', () => {
  it('is empty without groups', () => {
    expect(loadOverview(snapshots(), deviceUserId)).toEqual({ groups: [], totals: [], transfers: [] });
  });

  it('nets per group, sums across groups and lists my transfers', () => {
    const goa = group('Goa', ['Rahul', 'Priya']);
    // I paid ₹900 for three → Rahul and Priya owe me ₹300 each.
    expense(goa.groupId, goa.me, goa.me, 90000, [goa.me, goa.id('Rahul'), goa.id('Priya')]);

    const flat = group('Flat', ['Amit']);
    // Amit paid ₹1,001 for two → I owe ₹500.50 (paise split is the domain's job; total stays exact).
    expense(flat.groupId, flat.me, flat.id('Amit'), 100100, [flat.me, flat.id('Amit')]);

    const overview = loadOverview(snapshots(), deviceUserId);
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
    goa.g.run('settlement.add', { id: goa.g.newId(), fromMemberId: goa.id('Rahul'), toMemberId: goa.me, amountPaise: 30000, method: 'cash' });

    const overview = loadOverview(snapshots(), deviceUserId);
    expect(overview.transfers).toEqual([]);
    expect(overview.totals).toEqual([]);
    expect(overview.groups[0]!.myBalance).toBe(0);
  });

  it('marks groups I left read-only but still counts their balances', () => {
    const goa = group('Goa', ['Rahul']);
    expense(goa.groupId, goa.me, goa.me, 60000, [goa.me, goa.id('Rahul')]);
    const overview = loadOverview(snapshots(), otherUserId());
    expect(overview.groups[0]).toEqual(expect.objectContaining({ me: null, canEdit: false }));
    expect(overview.transfers).toEqual([]);
  });

  it('keeps totals per currency and never adds amounts across currencies', () => {
    const goa = group('Goa', ['Rahul']);
    expense(goa.groupId, goa.me, goa.me, 60000, [goa.me, goa.id('Rahul')]); // Rahul owes me ₹300
    const bali = group('Bali', ['Priya'], 'IDR');
    // Priya paid Rp1,000,000.00 for two → I owe Rp500,000.00 (IDR has 2 minor digits).
    expense(bali.groupId, bali.me, bali.id('Priya'), 100_000_000, [bali.me, bali.id('Priya')]);
    const tokyo = group('Tokyo', ['Amit'], 'JPY');
    expense(tokyo.groupId, tokyo.me, tokyo.me, 3001, [tokyo.me, tokyo.id('Amit')]); // ¥3,001 for two

    const overview = loadOverview(snapshots(), deviceUserId);
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
    expect(addExpenseTarget(editableGroups(snapshots(), deviceUserId))).toEqual({ kind: 'group', groupId: goa.groupId });
    group('Flat', ['Amit']);
    expect(addExpenseTarget(editableGroups(snapshots(), deviceUserId))).toEqual({ kind: 'pick' });
  });

  it('never offers a group I am not a member of', () => {
    group('Goa', ['Rahul']);
    expect(editableGroups(snapshots(), otherUserId())).toEqual([]);
  });
});

describe('loadRecentActivity', () => {
  it('merges activity across groups, newest first, with group names', () => {
    const goa = group('Goa', ['Rahul']);
    const flat = group('Flat', ['Amit']);
    expense(goa.groupId, goa.me, goa.me, 1000, [goa.me, goa.id('Rahul')]);
    expense(flat.groupId, flat.me, flat.me, 2000, [flat.me, flat.id('Amit')]);

    const entries = groups.flatMap((g) => g.activity()).sort((a, b) => b.createdAt - a.createdAt);
    const items = loadRecentActivity(entries, snapshots(), deviceUserId);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.groupName).toBe('Flat');
    expect(items[0]!.title.startsWith('You')).toBe(true);
    // A group I'm no longer in drops out.
    expect(loadRecentActivity(entries, [flat.g.snapshot()], deviceUserId).every((i) => i.groupName === 'Flat')).toBe(true);
  });
});
