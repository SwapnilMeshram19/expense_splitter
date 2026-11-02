import {
  applyPlan,
  markValue,
  planCommand,
  rebaseCommand,
  type CommandInputs,
  type Plan,
  type PlanContext,
} from '../commands';
import { ALL_WEEKDAYS, markId, type ServiceFields } from '../household';
import type { GroupSnapshot } from '../model';

const U1 = 'a0000000-0000-4000-8000-000000000001';
const U2 = 'a0000000-0000-4000-8000-000000000002';
const G = '90000000-0000-4000-8000-000000000001';
const ME = 'b0000000-0000-4000-8000-000000000001';
const FLATMATE = 'b0000000-0000-4000-8000-000000000002';
const SVC = '70000000-0000-4000-8000-000000000001';
const E1 = 'e0000000-0000-4000-8000-000000000001';
const E2 = 'e0000000-0000-4000-8000-000000000002';

// 20 Oct 2026, 12:00 UTC
const NOW = Date.UTC(2026, 9, 20, 12);
let seq = 0;
const ctx = (userId = U1, now = NOW): PlanContext => ({
  userId,
  now,
  newId: () => `d0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
});
const life = { createdAt: 1, updatedAt: 1, deletedAt: null, version: 1 };

function snapshot(): GroupSnapshot {
  return {
    rev: '1',
    group: {
      id: G,
      name: 'Flat 4B',
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
        id: FLATMATE,
        groupId: G,
        displayName: 'Riya',
        userId: U2,
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

const milk: ServiceFields = {
  name: 'Milk',
  kind: 'per_unit',
  unit: 'L',
  defaultQty: 100,
  rates: [{ from: '2026-10-01', ratePaise: 3000 }],
  weekdays: ALL_WEEKDAYS,
  paidLeaves: 0,
  startDate: '2026-10-01',
  endDate: null,
};

const ok = (r: { ok: boolean; plan?: Plan; error?: unknown }): Plan => {
  if (!r.ok || !r.plan) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r.plan;
};

function run<K extends keyof CommandInputs>(
  s: GroupSnapshot,
  op: K,
  input: CommandInputs[K],
  c = ctx(),
): GroupSnapshot {
  return applyPlan(s, ok(planCommand(s, c, { op, input })))!;
}

const withMilk = () => run(snapshot(), 'household.create', { groupId: G, id: SVC, ...milk });

describe('household.create / update / delete', () => {
  it('creates a service, logs it on the group and locks the currency', () => {
    const plan = ok(
      planCommand(snapshot(), ctx(), {
        op: 'household.create',
        input: { groupId: G, id: SVC, ...milk },
      }),
    );
    expect(plan.batch.household_services).toHaveLength(1);
    expect(plan.batch.household_services![0]).toMatchObject({
      name: 'Milk',
      group_currency: 'INR',
      base_version: 0,
      bills: {},
    });
    expect(plan.batch.activity[0]).toMatchObject({
      entity_type: 'group',
      action: 'update',
      after: { serviceAction: 'create' },
    });
    const s = applyPlan(snapshot(), plan)!;
    expect(s.householdServices.map((h) => h.name)).toEqual(['Milk']);
    expect(s.currencyLocked).toBe(true);
  });

  it('refuses a second service with the same name and edits from non-members', () => {
    const s = withMilk();
    expect(
      planCommand(s, ctx(), {
        op: 'household.create',
        input: { groupId: G, id: E2, ...milk, name: 'MILK' },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_NAME', name: 'MILK' },
    });
    expect(
      planCommand(s, ctx('a0000000-0000-4000-8000-000000000009'), {
        op: 'household.delete',
        input: { groupId: G, serviceId: SVC, expectedVersion: 1 },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
  });

  it('updates with a version check and writes nothing when nothing changed', () => {
    const s = withMilk();
    expect(
      planCommand(s, ctx(), {
        op: 'household.update',
        input: { groupId: G, serviceId: SVC, expectedVersion: 0, ...milk },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'STALE' },
    });
    const same = ok(
      planCommand(s, ctx(), {
        op: 'household.update',
        input: { groupId: G, serviceId: SVC, expectedVersion: 1, ...milk },
      }),
    );
    expect(same.batch.household_services).toHaveLength(0);
    const hike = { ...milk, rates: [...milk.rates, { from: '2026-10-15', ratePaise: 3200 }] };
    const after = run(s, 'household.update', {
      groupId: G,
      serviceId: SVC,
      expectedVersion: 1,
      ...hike,
    });
    expect(after.householdServices[0]!.rates).toHaveLength(2);
    expect(after.householdServices[0]!.version).toBe(2);
  });

  it('deletes', () => {
    const s = run(withMilk(), 'household.delete', {
      groupId: G,
      serviceId: SVC,
      expectedVersion: 1,
    });
    expect(s.householdServices).toEqual([]);
  });
});

describe('household.mark', () => {
  const mark = (s: GroupSnapshot, qty: number | null, expected: number | null, c = ctx()) =>
    planCommand(s, c, {
      op: 'household.mark',
      input: { groupId: G, serviceId: SVC, date: '2026-10-05', qty, expected },
    });

  it('stores an exception with a derived id, and nothing for "usual"', () => {
    const plan = ok(mark(withMilk(), 0, null));
    expect(plan.entityId).toBe(markId(SVC, '2026-10-05'));
    expect(plan.batch.household_marks![0]).toMatchObject({
      qty: 0,
      mark_date: '2026-10-05',
      base_version: 0,
    });
    expect(plan.batch.activity).toHaveLength(0);
    // 1 L is the usual: nothing to store.
    expect(ok(mark(withMilk(), 100, null)).batch.household_marks).toHaveLength(0);
  });

  it('keeps the row when a day goes back to usual, so its version carries on', () => {
    const absent = applyPlan(withMilk(), ok(mark(withMilk(), 0, null)))!;
    const back = ok(mark(absent, null, 0));
    expect(back.batch.household_marks![0]).toMatchObject({ qty: null, base_version: 1 });
    expect(markValue(applyPlan(absent, back)!, SVC, '2026-10-05')).toBeNull();
  });

  it('refuses to overwrite someone else’s mark, but agrees when they set the same thing', () => {
    const riyaMarked = applyPlan(withMilk(), ok(mark(withMilk(), 200, null, ctx(U2))))!;
    // I marked "absent" on a phone that hadn't seen Riya's 2 L.
    expect(mark(riyaMarked, 0, null)).toEqual({
      ok: false,
      error: { code: 'MARK_CONFLICT', current: 200 },
    });
    expect(ok(mark(riyaMarked, 200, null)).batch.household_marks).toHaveLength(0);
  });

  it('“Try again” re-bases on the current mark (keep mine)', () => {
    const riyaMarked = applyPlan(withMilk(), ok(mark(withMilk(), 200, null, ctx(U2))))!;
    const cmd = {
      op: 'household.mark' as const,
      input: { groupId: G, serviceId: SVC, date: '2026-10-05', qty: 0, expected: null },
    };
    const rebased = rebaseCommand(riyaMarked, cmd);
    expect(rebased.input).toMatchObject({ expected: 200 });
    expect(ok(planCommand(riyaMarked, ctx(), rebased)).batch.household_marks![0]).toMatchObject({
      qty: 0,
      base_version: 1,
    });
  });

  it('refuses days outside the window', () => {
    const s = withMilk();
    expect(
      planCommand(s, ctx(), {
        op: 'household.mark',
        input: { groupId: G, serviceId: SVC, date: '2026-09-30', qty: 0, expected: null },
      }),
    ).toEqual({
      ok: false,
      error: { code: 'OUT_OF_RANGE' },
    });
  });
});

describe('household.postBill', () => {
  const post = (s: GroupSnapshot, over: Partial<CommandInputs['household.postBill']> = {}) =>
    planCommand(s, ctx(), {
      op: 'household.postBill',
      input: {
        groupId: G,
        serviceId: SVC,
        expectedVersion: s.householdServices[0]!.version,
        month: '2026-10',
        upTo: '2026-10-20',
        expenseId: E1,
        expectedExpenseVersion: null,
        paidByMemberId: ME,
        memberIds: [ME, FLATMATE],
        ...over,
      },
    });

  it('posts the computed bill as an equal split and links it to the month', () => {
    const s = run(withMilk(), 'household.mark', {
      groupId: G,
      serviceId: SVC,
      date: '2026-10-05',
      qty: 0,
      expected: null,
    });
    const plan = ok(post(s));
    const expense = plan.batch.expenses[0]!;
    // 19 L × ₹30, whatever the phone claims
    expect(expense).toMatchObject({
      id: E1,
      amount_paise: 57_000,
      description: 'Milk · Oct 2026',
      category: 'other',
      category_label: 'Home',
      expense_date: '2026-10-20',
    });
    expect(expense.shares).toEqual([
      { member_id: ME, amount_paise: 28_500 },
      { member_id: FLATMATE, amount_paise: 28_500 },
    ]);
    expect(expense.note).toBe('19 L × ₹30 = ₹570\n1 day skipped\nTill 20 Oct 2026');
    expect(plan.batch.household_services![0]!.bills).toEqual({ '2026-10': E1 });
  });

  it('updates the posted expense in place when the month changed', () => {
    let s = applyPlan(withMilk(), ok(post(withMilk())))!;
    s = run(s, 'household.mark', {
      groupId: G,
      serviceId: SVC,
      date: '2026-10-06',
      qty: 300,
      expected: null,
    });
    expect(post(s, { expectedExpenseVersion: null }).ok).toBe(false); // must name the posted version
    const plan = ok(post(s, { expectedExpenseVersion: 1, expenseId: E2 }));
    expect(plan.entityId).toBe(E1);
    expect(plan.batch.expenses[0]).toMatchObject({ id: E1, amount_paise: 66_000, base_version: 1 });
    // Same link: the service row isn't rewritten.
    expect(plan.batch.household_services).toHaveLength(0);
  });

  it('posts a new expense when the posted one was deleted', () => {
    let s = applyPlan(withMilk(), ok(post(withMilk())))!;
    s = run(s, 'expense.delete', { groupId: G, expenseId: E1, expectedVersion: 1 });
    const plan = ok(post(s, { expenseId: E2 }));
    expect(plan.batch.expenses[0]).toMatchObject({ id: E2, base_version: 0 });
    expect(plan.batch.household_services![0]!.bills).toEqual({ '2026-10': E2 });
  });

  it('refuses months it can’t bill and empty bills', () => {
    const s = withMilk();
    expect(post(s, { month: '2026-09', upTo: '2026-09-30' })).toEqual({
      ok: false,
      error: { code: 'INVALID_MONTH' },
    });
    expect(post(s, { month: '2026-11', upTo: '2026-11-01' })).toEqual({
      ok: false,
      error: { code: 'INVALID_MONTH' },
    });
    expect(post(s, { upTo: '2026-10-25' })).toEqual({
      ok: false,
      error: { code: 'INVALID_MONTH' },
    });
    const stopped = run(s, 'household.update', {
      groupId: G,
      serviceId: SVC,
      expectedVersion: 1,
      ...milk,
      defaultQty: 100,
      weekdays: 1 << 0,
    });
    // Only Sundays: 4, 11, 18 Oct → still billable. Mark them all absent → nothing to bill.
    let t = stopped;
    for (const d of ['2026-10-04', '2026-10-11', '2026-10-18']) {
      t = run(t, 'household.mark', { groupId: G, serviceId: SVC, date: d, qty: 0, expected: null });
    }
    expect(post(t)).toEqual({ ok: false, error: { code: 'NOTHING_TO_BILL' } });
  });

  it('checks the split like any expense', () => {
    expect(post(withMilk(), { memberIds: [] })).toMatchObject({
      ok: false,
      error: { code: 'SPLIT' },
    });
    expect(
      post(withMilk(), { paidByMemberId: 'b0000000-0000-4000-8000-000000000009' }),
    ).toMatchObject({ ok: false });
  });
});
