import { applyPlan, planCommand, type CommandInputs } from '@/domain/commands';
import { ALL_WEEKDAYS } from '@/domain/household';
import type { GroupSnapshot, HouseholdService } from '@/domain/model';
import { describeActivity } from '@/features/activity/describeActivity';
import { pendingReason, pendingTitle } from '@/features/data/describePending';

import { describeHouseholdError } from '../messages';
import { initialForm, priceChanged, toFields } from '../serviceForm';
import { defaultBillPeople, loadHouseholdList, loadServiceMonth } from '../view';

const U1 = 'a0000000-0000-4000-8000-000000000001';
const G = '90000000-0000-4000-8000-000000000001';
const ME = 'b0000000-0000-4000-8000-000000000001';
const RIYA = 'b0000000-0000-4000-8000-000000000002';
const MILK = '70000000-0000-4000-8000-000000000001';
const MAID = '70000000-0000-4000-8000-000000000002';
const life = { createdAt: 1, updatedAt: 1, deletedAt: null, version: 1 };
const NOW = Date.UTC(2026, 9, 20, 6);
const TODAY = '2026-10-20';

function base(): GroupSnapshot {
  return {
    rev: '1',
    group: {
      id: G,
      name: 'Flat',
      simplifyDebts: true,
      currency: 'INR',
      budgetPaise: null,
      budgetPeriod: null,
      ...life,
    },
    members: [
      {
        id: ME,
        groupId: G,
        displayName: 'Asha',
        userId: U1,
        upiVpa: null,
        payMethods: null,
        ...life,
      },
      {
        id: RIYA,
        groupId: G,
        displayName: 'Riya',
        userId: null,
        upiVpa: null,
        payMethods: null,
        ...life,
      },
    ],
    expenses: [],
    settlements: [],
    rules: [],
    currencyLocked: false,
    rulesWithOccurrences: [],
    householdServices: [],
    householdMarks: [],
  };
}

let seq = 0;
function run<K extends keyof CommandInputs>(
  s: GroupSnapshot,
  op: K,
  input: CommandInputs[K],
): GroupSnapshot {
  const plan = planCommand(
    s,
    {
      userId: U1,
      now: NOW,
      newId: () => `d0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    },
    { op, input },
  );
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  return applyPlan(s, plan.plan)!;
}

function fixture(): GroupSnapshot {
  let s = run(base(), 'household.create', {
    groupId: G,
    id: MILK,
    name: 'Milk',
    kind: 'per_unit',
    unit: 'L',
    defaultQty: 100,
    rates: [{ from: '2026-10-01', ratePaise: 3000 }],
    weekdays: ALL_WEEKDAYS,
    paidLeaves: 0,
    startDate: '2026-10-01',
    endDate: null,
  });
  s = run(s, 'household.create', {
    groupId: G,
    id: MAID,
    name: 'Maid',
    kind: 'monthly',
    unit: null,
    defaultQty: 100,
    rates: [{ from: '2026-10-01', ratePaise: 300_000 }],
    weekdays: ALL_WEEKDAYS & ~1,
    paidLeaves: 2,
    startDate: '2026-10-01',
    endDate: null,
  });
  s = run(s, 'household.mark', {
    groupId: G,
    serviceId: MILK,
    date: TODAY,
    qty: 200,
    expected: null,
  });
  return run(s, 'household.mark', {
    groupId: G,
    serviceId: MAID,
    date: TODAY,
    qty: 0,
    expected: null,
  });
}

describe('home services list', () => {
  it('shows today and the month so far', () => {
    const list = loadHouseholdList(fixture(), U1, TODAY)!;
    expect(list.me).toBe(ME);
    expect(
      list.items.map((i) => [i.service.name, i.status, i.qty, i.stored, i.monthAmount]),
    ).toEqual([
      // 19 usual days + 2 L today = 21 L × ₹30
      ['Milk', '2 L today', 200, 200, 63_000],
      // 17 working days so far (Sundays off), 1 absence covered by paid leave; fee over 27 days
      ['Maid', 'Absent today', 0, 0, Math.round((300_000 * 17) / 27)],
    ]);
  });

  it('is read-only for someone who isn’t in the group', () => {
    expect(
      loadHouseholdList(fixture(), 'a0000000-0000-4000-8000-000000000009', TODAY)!.me,
    ).toBeNull();
  });
});

describe('service month', () => {
  it('builds a Monday-first calendar and the bill', () => {
    const m = loadServiceMonth(fixture(), MILK, '2026-10', U1, TODAY)!;
    expect(m.leadingBlanks).toBe(3); // 1 Oct 2026 is a Thursday
    expect(m.days).toHaveLength(31);
    expect(m.days[19]).toMatchObject({
      date: TODAY,
      state: 'more',
      qty: 200,
      isToday: true,
      editable: true,
    });
    expect(m.bill?.amountPaise).toBe(63_000);
    expect(m.canPost).toBe(true);
    expect(m.prevMonth).toBeNull(); // the service started this month
    expect(m.nextMonth).toBe('2026-11');
  });

  it('has no bill for a month that hasn’t started', () => {
    const m = loadServiceMonth(fixture(), MILK, '2026-11', U1, TODAY)!;
    expect(m.bill).toBeNull();
    expect(m.canPost).toBe(false);
    expect(m.days[0]!.editable).toBe(true);
  });

  it('notices a posted bill that no longer matches', () => {
    let s = fixture();
    s = run(s, 'household.postBill', {
      groupId: G,
      serviceId: MILK,
      expectedVersion: s.householdServices[0]!.version,
      month: '2026-10',
      upTo: TODAY,
      expenseId: 'e0000000-0000-4000-8000-000000000001',
      expectedExpenseVersion: null,
      paidByMemberId: ME,
      memberIds: [ME, RIYA],
    });
    expect(loadServiceMonth(s, MILK, '2026-10', U1, TODAY)).toMatchObject({
      billChanged: false,
      canPost: false,
    });
    s = run(s, 'household.mark', {
      groupId: G,
      serviceId: MILK,
      date: '2026-10-19',
      qty: 0,
      expected: null,
    });
    const m = loadServiceMonth(s, MILK, '2026-10', U1, TODAY)!;
    expect(m).toMatchObject({ billChanged: true, canPost: true });
    expect(defaultBillPeople(s, m.posted, ME)).toEqual({ paidBy: ME, memberIds: [ME, RIYA] });
  });
});

describe('service form', () => {
  const svc = (): HouseholdService => fixture().householdServices[0]!;

  it('starts a new service on the 1st of the month', () => {
    expect(initialForm(null, TODAY, 'INR')).toMatchObject({
      startDate: '2026-10-01',
      kind: 'per_unit',
      unit: 'L',
    });
  });

  it('keeps old days at the old price when the price changes', () => {
    const state = { ...initialForm(svc(), TODAY, 'INR'), priceText: '32' };
    expect(priceChanged(state, svc(), TODAY, 'INR')).toBe(true);
    const fields = toFields({ ...state, priceFrom: 'today' }, svc(), TODAY, 'INR');
    expect(fields.ok && fields.fields.rates).toEqual([
      { from: '2026-10-01', ratePaise: 3000 },
      { from: TODAY, ratePaise: 3200 },
    ]);
    // "From the 1st" on a service that started on the 1st = one price for the whole month.
    const month = toFields({ ...state, priceFrom: 'month' }, svc(), TODAY, 'INR');
    expect(month.ok && month.fields.rates).toEqual([{ from: '2026-10-01', ratePaise: 3200 }]);
  });

  it('asks for a price', () => {
    expect(
      toFields({ ...initialForm(null, TODAY, 'INR'), priceText: '' }, null, TODAY, 'INR'),
    ).toEqual({ ok: false, message: 'Enter the price.' });
  });
});

describe('text', () => {
  it('describes errors and history', () => {
    const nameOf = () => 'Riya';
    expect(
      describeHouseholdError({ code: 'DUPLICATE_NAME', name: 'Milk' }, nameOf, 'INR'),
    ).toContain('already a “Milk”');
    expect(describeHouseholdError({ code: 'BILL_TOO_LARGE', max: 100 }, nameOf, 'INR')).toContain(
      '₹1',
    );
    expect(describeHouseholdError({ code: 'STALE' }, nameOf, 'INR')).toContain(
      'Someone else changed this',
    );
    const entry = {
      id: 'd1',
      groupId: G,
      entityType: 'group' as const,
      entityId: G,
      action: 'update' as const,
      actorMemberId: ME,
      before: null,
      after: {
        householdService: { id: MILK, name: 'Milk', kind: 'per_unit' },
        serviceAction: 'create',
      },
      createdAt: 1,
    };
    expect(describeActivity(entry, { me: ME, nameOf: () => 'Asha', currency: 'INR' }).title).toBe(
      'You added “Milk” to home services',
    );
  });

  it('describes a refused day on Not saved yet', () => {
    const s = fixture();
    const cmd = {
      op: 'household.mark' as const,
      input: { groupId: G, serviceId: MILK, date: '2026-10-05', qty: 0, expected: null },
    };
    expect(pendingTitle(cmd, 'INR', s)).toBe('Milk on 5 Oct 2026');
    expect(
      pendingReason({
        requestId: 'r',
        groupId: G,
        cmd,
        at: 1,
        status: 'failed',
        error: { code: 'MARK_CONFLICT', current: 200 },
      }),
    ).toBe(
      'Someone else marked this day with another amount. Try again keeps yours, Discard keeps theirs.',
    );
  });
});
