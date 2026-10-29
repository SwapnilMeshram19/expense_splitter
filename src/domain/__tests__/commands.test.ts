import { applyPlan, planCommand, type Plan, type PlanContext } from '../commands';
import type { GroupSnapshot } from '../model';

const U1 = 'a0000000-0000-4000-8000-000000000001';
const U2 = 'a0000000-0000-4000-8000-000000000002';
const G = '90000000-0000-4000-8000-000000000001';
const ME = 'b0000000-0000-4000-8000-000000000001';
const MOM = 'b0000000-0000-4000-8000-000000000002';
const RAHUL = 'b0000000-0000-4000-8000-000000000003';
const E1 = 'e0000000-0000-4000-8000-000000000001';
const S1 = 'c0000000-0000-4000-8000-000000000001';
const R1 = 'f0000000-0000-4000-8000-000000000001';

let seq = 0;
const ctx = (userId = U1): PlanContext => ({
  userId,
  now: 1_000,
  newId: () => `d0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
});

const life = { createdAt: 1, updatedAt: 1, deletedAt: null, version: 1 };

function snapshot(over: Partial<GroupSnapshot> = {}): GroupSnapshot {
  return {
    rev: '1',
    group: { id: G, name: 'Goa', simplifyDebts: true, currency: 'INR', budgetPaise: null, budgetPeriod: null, ...life },
    members: [
      { id: ME, groupId: G, displayName: 'Asha', userId: U1, upiVpa: null, payMethods: null, ...life },
      { id: MOM, groupId: G, displayName: 'Mom', userId: null, upiVpa: null, payMethods: null, ...life },
      { id: RAHUL, groupId: G, displayName: 'Rahul', userId: U2, upiVpa: 'rahul@okaxis', payMethods: null, ...life },
    ],
    expenses: [],
    settlements: [],
    rules: [],
    currencyLocked: false,
    rulesWithOccurrences: [],
    ...over,
  };
}

const dinner = {
  description: '  Dinner ',
  amountPaise: 90_000,
  expenseDate: '2026-10-01',
  payers: [{ memberId: ME, amountPaise: 90_000 }],
  splitInput: { type: 'equal' as const, memberIds: [ME, MOM, RAHUL] },
};

function withExpense(): GroupSnapshot {
  const plan = planCommand(snapshot(), ctx(), { op: 'expense.add', input: { groupId: G, id: E1, ...dinner } });
  if (!plan.ok) throw new Error('setup');
  return applyPlan(snapshot(), plan.plan)!;
}

const ok = (r: { ok: boolean; plan?: Plan }): Plan => {
  if (!r.ok || !r.plan) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r.plan;
};

describe('group.create', () => {
  it('creates the group, me (linked), placeholders and one history entry', () => {
    const plan = ok(
      planCommand(null, ctx(), {
        op: 'group.create',
        input: { id: G, name: ' Goa  trip ', myMemberId: ME, myName: 'Asha', members: [{ id: MOM, name: 'Mom' }], currency: 'USD' },
      }),
    );
    expect(plan.batch.groups).toEqual([expect.objectContaining({ id: G, name: 'Goa trip', currency: 'USD', base_version: 0 })]);
    expect(plan.batch.members).toEqual([
      expect.objectContaining({ id: ME, user_id: U1, display_name: 'Asha' }),
      expect.objectContaining({ id: MOM, user_id: null }),
    ]);
    expect(plan.batch.activity).toEqual([
      expect.objectContaining({ entity_type: 'group', action: 'create', actor_member_id: ME, after: { name: 'Goa trip', members: ['Asha', 'Mom'], currency: 'USD' } }),
    ]);
  });

  it('copies my payment details onto my member', () => {
    const plan = ok(
      planCommand(null, ctx(), {
        op: 'group.create',
        input: { id: G, name: 'Goa', myMemberId: ME, myName: 'Asha', myUpiVpa: 'Asha@OKHDFC', myPayMethods: [{ kind: 'link', url: 'https://paypal.me/asha' }] },
      }),
    );
    expect(plan.batch.members[0]).toEqual(
      expect.objectContaining({ upi_vpa: 'asha@okhdfc', pay_methods: [{ kind: 'link', url: 'https://paypal.me/asha' }] }),
    );
  });

  it.each([
    [{ name: '  ' }, { code: 'INVALID_GROUP_NAME', error: { code: 'NAME_REQUIRED' } }],
    [{ members: [{ id: MOM, name: 'asha' }] }, { code: 'INVALID_MEMBER_NAME', error: { code: 'DUPLICATE_NAME', name: 'asha' } }],
    [{ currency: 'XXX' }, { code: 'UNKNOWN_CURRENCY' }],
    [{ myMemberId: G }, { code: 'ID_TAKEN' }],
  ])('rejects %j', (over, error) => {
    const r = planCommand(null, ctx(), { op: 'group.create', input: { id: G, name: 'Goa', myMemberId: ME, myName: 'Asha', ...over } });
    expect(r).toEqual({ ok: false, error });
  });

  it('refuses an id that already exists', () => {
    expect(planCommand(snapshot(), ctx(), { op: 'group.create', input: { id: G, name: 'x', myMemberId: ME, myName: 'A' } })).toEqual({
      ok: false,
      error: { code: 'ID_TAKEN' },
    });
  });
});

describe('group.update / delete', () => {
  it('logs one entry per changed setting and clears the budget on a currency change', () => {
    const s = snapshot({ group: { ...snapshot().group, budgetPaise: 500_000, budgetPeriod: 'total' } });
    const plan = ok(planCommand(s, ctx(), { op: 'group.update', input: { groupId: G, expectedVersion: 1, name: 'Goa 2026', currency: 'USD' } }));
    expect(plan.batch.groups[0]).toEqual(
      expect.objectContaining({ name: 'Goa 2026', currency: 'USD', budget_paise: null, budget_period: null, base_version: 1 }),
    );
    expect(plan.batch.activity.map((a) => a.after)).toEqual([{ name: 'Goa 2026' }, { currency: 'USD' }]);
  });

  it('is a no-op when nothing changes', () => {
    const plan = ok(planCommand(snapshot(), ctx(), { op: 'group.update', input: { groupId: G, expectedVersion: 1, name: 'Goa' } }));
    expect(plan.batch.groups).toEqual([]);
  });

  it.each([
    [{ expectedVersion: 0 }, { code: 'STALE' }],
    [{ currency: 'USD' }, { code: 'CURRENCY_LOCKED' }],
    [{ budget: { limit: 0, period: 'total' as const } }, { code: 'INVALID_BUDGET', max: expect.any(Number) }],
  ])('rejects %j', (over, error) => {
    const r = planCommand(snapshot({ currencyLocked: true }), ctx(), { op: 'group.update', input: { groupId: G, expectedVersion: 1, ...over } });
    expect(r).toEqual({ ok: false, error });
  });

  it('refuses people who are not active members', () => {
    expect(planCommand(snapshot(), ctx('a0000000-0000-4000-8000-0000000000ff'), { op: 'group.update', input: { groupId: G, expectedVersion: 1, name: 'x' } })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
  });

  it('deletes only a settled group', () => {
    expect(planCommand(withExpense(), ctx(), { op: 'group.delete', input: { groupId: G, expectedVersion: 1 } })).toEqual({
      ok: false,
      error: { code: 'UNSETTLED_BALANCES', count: 3 },
    });
    const plan = ok(planCommand(snapshot(), ctx(), { op: 'group.delete', input: { groupId: G, expectedVersion: 1 } }));
    expect(plan.batch.groups[0]!.deleted_at).toBe(1_000);
  });
});

describe('members', () => {
  it('adds a placeholder, refusing duplicate names', () => {
    const id = 'b0000000-0000-4000-8000-000000000009';
    expect(ok(planCommand(snapshot(), ctx(), { op: 'member.add', input: { groupId: G, id, displayName: 'Dad' } })).batch.members[0]).toEqual(
      expect.objectContaining({ id, user_id: null, display_name: 'Dad', base_version: 0 }),
    );
    expect(planCommand(snapshot(), ctx(), { op: 'member.add', input: { groupId: G, id, displayName: 'mom' } })).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_NAME', name: 'mom' },
    });
  });

  it("edits a placeholder's UPI ID, masks it in the history, but never another account's", () => {
    const plan = ok(planCommand(snapshot(), ctx(), { op: 'member.update', input: { groupId: G, memberId: MOM, expectedVersion: 1, upiVpa: 'mom@okicici' } }));
    expect(plan.batch.members[0]).toEqual(expect.objectContaining({ upi_vpa: 'mom@okicici', user_id: null }));
    expect(plan.batch.activity[0]!.after).toEqual({ upiVpa: expect.stringContaining('@okicici') });
    expect(JSON.stringify(plan.batch.activity)).not.toContain('mom@okicici');

    expect(planCommand(snapshot(), ctx(), { op: 'member.update', input: { groupId: G, memberId: RAHUL, expectedVersion: 1, upiVpa: null } })).toEqual({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    });
  });

  it('rejects invalid payment methods', () => {
    const bad = [{ kind: 'link', url: 'javascript:alert(1)' }] as never;
    expect(planCommand(snapshot(), ctx(), { op: 'member.update', input: { groupId: G, memberId: ME, expectedVersion: 1, payMethods: bad } })).toEqual({
      ok: false,
      error: { code: 'INVALID_PAY_METHOD' },
    });
  });

  it('removes only a member with a zero balance, never yourself', () => {
    expect(planCommand(withExpense(), ctx(), { op: 'member.remove', input: { groupId: G, memberId: MOM, expectedVersion: 1 } })).toEqual({
      ok: false,
      error: { code: 'MEMBER_HAS_BALANCE', balancePaise: -30_000 },
    });
    expect(planCommand(snapshot(), ctx(), { op: 'member.remove', input: { groupId: G, memberId: ME, expectedVersion: 1 } })).toEqual({
      ok: false,
      error: { code: 'CANNOT_REMOVE_SELF' },
    });
    const plan = ok(planCommand(snapshot(), ctx(), { op: 'member.remove', input: { groupId: G, memberId: MOM, expectedVersion: 1 } }));
    expect(plan.batch.members[0]!.deleted_at).toBe(1_000);
  });
});

describe('expenses', () => {
  it('computes the shares itself and records who did it', () => {
    const plan = ok(planCommand(snapshot(), ctx(), { op: 'expense.add', input: { groupId: G, id: E1, ...dinner } }));
    const row = plan.batch.expenses[0]!;
    expect(row).toEqual(
      expect.objectContaining({ description: 'Dinner', created_by_member_id: ME, group_currency: 'INR', base_version: 0, category: 'general' }),
    );
    expect(row.shares.map((l) => l.amount_paise)).toEqual([30_000, 30_000, 30_000]);
    expect(plan.batch.activity[0]).toEqual(expect.objectContaining({ entity_type: 'expense', action: 'create', actor_member_id: ME }));
  });

  it('refuses a split naming someone outside the group, and a reused id', () => {
    const outsider = 'b0000000-0000-4000-8000-0000000000aa';
    expect(
      planCommand(snapshot(), ctx(), { op: 'expense.add', input: { groupId: G, id: E1, ...dinner, splitInput: { type: 'equal', memberIds: [ME, outsider] } } }),
    ).toEqual({ ok: false, error: { code: 'UNKNOWN_MEMBER', memberId: outsider } });
    expect(planCommand(withExpense(), ctx(), { op: 'expense.add', input: { groupId: G, id: E1, ...dinner } })).toEqual({
      ok: false,
      error: { code: 'ID_TAKEN' },
    });
  });

  it('updates on the version it was made on, keeping the note when not given', () => {
    const s = withExpense();
    const withNote = applyPlan(s, ok(planCommand(s, ctx(), { op: 'expense.update', input: { groupId: G, expenseId: E1, expectedVersion: 1, ...dinner, note: 'paid in cash' } })))!;
    const plan = ok(planCommand(withNote, ctx(), { op: 'expense.update', input: { groupId: G, expenseId: E1, expectedVersion: 2, ...dinner, amountPaise: 60_000, payers: [{ memberId: ME, amountPaise: 60_000 }] } }));
    expect(plan.batch.expenses[0]).toEqual(expect.objectContaining({ amount_paise: 60_000, note: 'paid in cash', base_version: 2 }));
    expect(plan.batch.activity[0]!.before).toEqual(expect.objectContaining({ amountPaise: 90_000 }));
    expect(planCommand(withNote, ctx(), { op: 'expense.update', input: { groupId: G, expenseId: E1, expectedVersion: 1, ...dinner } })).toEqual({
      ok: false,
      error: { code: 'STALE' },
    });
  });

  it('deletes with a history entry holding the old values', () => {
    const plan = ok(planCommand(withExpense(), ctx(), { op: 'expense.delete', input: { groupId: G, expenseId: E1, expectedVersion: 1 } }));
    expect(plan.batch.expenses[0]!.deleted_at).toBe(1_000);
    expect(plan.batch.activity[0]!.before).toEqual(expect.objectContaining({ description: 'Dinner' }));
    expect(applyPlan(withExpense(), plan)!.expenses).toEqual([]);
  });

  it('turns malformed input into an error instead of throwing', () => {
    expect(planCommand(snapshot(), ctx(), { op: 'expense.add', input: { groupId: G, id: 42 } as never })).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});

describe('settlements', () => {
  const pay = { groupId: G, id: S1, fromMemberId: MOM, toMemberId: ME, amountPaise: 30_000, method: 'upi' as const };

  it('records a payment at the given time', () => {
    const plan = ok(planCommand(snapshot(), ctx(), { op: 'settlement.add', input: { ...pay, settledAt: 900, note: '  thanks  ' } }));
    expect(plan.batch.settlements[0]).toEqual(expect.objectContaining({ settled_at: 900, note: 'thanks', created_by_member_id: ME }));
  });

  it.each([
    [{ toMemberId: MOM }, { code: 'SAME_PERSON' }],
    [{ amountPaise: 0 }, { code: 'INVALID_AMOUNT' }],
    [{ method: 'cheque' }, { code: 'INVALID_METHOD' }],
    [{ settledAt: 10_000_000 }, { code: 'INVALID_TIME' }],
  ])('rejects %j', (over, error) => {
    expect(planCommand(snapshot(), ctx(), { op: 'settlement.add', input: { ...pay, ...over } as never })).toEqual({ ok: false, error });
  });

  it('settles the balance', () => {
    const s = applyPlan(withExpense(), ok(planCommand(withExpense(), ctx(), { op: 'settlement.add', input: pay })))!;
    expect(planCommand(s, ctx(), { op: 'member.remove', input: { groupId: G, memberId: MOM, expectedVersion: 1 } }).ok).toBe(true);
    const del = ok(planCommand(s, ctx(), { op: 'settlement.delete', input: { groupId: G, settlementId: S1, expectedVersion: 1 } }));
    expect(applyPlan(s, del)!.settlements).toEqual([]);
  });
});

describe('recurring rules', () => {
  const rent = {
    description: 'Rent',
    amountPaise: 1_500_000,
    payers: [{ memberId: ME, amountPaise: 1_500_000 }],
    splitInput: { type: 'equal' as const, memberIds: [ME, RAHUL] },
    frequency: 'monthly' as const,
    startDate: '2026-11-01',
    endDate: null,
    timeZone: 'Asia/Kolkata',
  };

  it('creates a rule with its computed template and asks for its due expenses', () => {
    const plan = ok(planCommand(snapshot(), ctx(), { op: 'recurring.create', input: { groupId: G, id: R1, ...rent } }));
    expect(plan.generateRuleId).toBe(R1);
    expect(plan.batch.recurring_rules[0]!.shares.map((l) => l.amount_paise)).toEqual([750_000, 750_000]);
    expect(plan.batch.activity[0]!.after).toEqual(expect.objectContaining({ ruleAction: 'create' }));
  });

  it('locks the schedule once an occurrence exists', () => {
    const s = applyPlan(snapshot(), ok(planCommand(snapshot(), ctx(), { op: 'recurring.create', input: { groupId: G, id: R1, ...rent } })))!;
    const locked = { ...s, rulesWithOccurrences: [R1] };
    expect(planCommand(locked, ctx(), { op: 'recurring.update', input: { groupId: G, ruleId: R1, expectedVersion: 1, ...rent, frequency: 'weekly' } })).toEqual({
      ok: false,
      error: { code: 'SCHEDULE_LOCKED' },
    });
    expect(planCommand(locked, ctx(), { op: 'recurring.update', input: { groupId: G, ruleId: R1, expectedVersion: 1, ...rent, timeZone: 'nope!' } })).toEqual({
      ok: false,
      error: { code: 'INVALID_TIME_ZONE' },
    });
    expect(ok(planCommand(locked, ctx(), { op: 'recurring.delete', input: { groupId: G, ruleId: R1, expectedVersion: 1 } })).batch.recurring_rules[0]!.deleted_at).toBe(1_000);
  });
});

describe('applyPlan', () => {
  it('builds a snapshot from a group create and bumps versions', () => {
    const plan = ok(planCommand(null, ctx(), { op: 'group.create', input: { id: G, name: 'Goa', myMemberId: ME, myName: 'Asha' } }));
    const s = applyPlan(null, plan)!;
    expect(s.group).toEqual(expect.objectContaining({ id: G, version: 1 }));
    expect(s.members).toHaveLength(1);
    expect(withExpense().currencyLocked).toBe(true);
  });
});
