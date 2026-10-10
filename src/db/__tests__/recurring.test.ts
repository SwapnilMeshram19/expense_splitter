import { eq } from 'drizzle-orm';

import { occurrenceActivityId, occurrenceId } from '@/domain/recurrence';

import { createExpense, getExpense } from '../repositories/expenses';
import { createGroup, isCurrencyLocked } from '../repositories/groups';
import { activeMembersQuery, removeMember } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import {
  createRule,
  deleteRule,
  generateDueOccurrences,
  groupRulesQuery,
  isPristineOccurrence,
  ruleProblem,
  updateRule,
  type RuleDraft,
} from '../repositories/recurring';
import { activityLog, expenses } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;
let device: string;
beforeEach(() => {
  t = createTestContext();
  device = getOrCreateDeviceUserId(t.ctx);
});
afterEach(() => t.close());

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Flat 302',
    selfName: 'Asha',
    otherMemberNames: ['Rahul', 'Priya'],
    deviceUserId: device,
  });
  if (!created.ok) throw new Error('group');
  const { groupId, selfMemberId: me } = created.value;
  const all = activeMembersQuery(t.ctx.db, groupId).all();
  const id = (name: string) => all.find((m) => m.displayName === name)!.id;
  return { groupId, me, rahul: id('Rahul'), priya: id('Priya') };
}

const rent = (g: ReturnType<typeof setup>, patch: Partial<RuleDraft> = {}): RuleDraft => ({
  groupId: g.groupId,
  description: 'Rent',
  amountPaise: 3_000_000, // ₹30,000 split three ways: ₹10,000 each
  payers: [{ memberId: g.me, amountPaise: 3_000_000 }],
  splitInput: { type: 'equal', memberIds: [g.me, g.rahul, g.priya] },
  frequency: 'monthly',
  startDate: '2026-08-01',
  endDate: null,
  timeZone: 'Asia/Kolkata',
  actorMemberId: g.me,
  ...patch,
});

describe('recurring rules', () => {
  it('stores the computed template and locks the group currency', () => {
    const g = setup();
    const created = createRule(t.ctx, rent(g));
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const rule = groupRulesQuery(t.ctx.db, g.groupId).all()[0]!;
    expect(rule.shares.map((s) => s.amountPaise)).toEqual([1_000_000, 1_000_000, 1_000_000]);
    expect(rule.payers).toEqual([{ memberId: g.me, amountPaise: 3_000_000 }]);
    expect(isCurrencyLocked(t.ctx.db, g.groupId)).toBe(true);
  });

  it('creates due occurrences with the shared ids, once', () => {
    const g = setup();
    const created = createRule(t.ctx, rent(g));
    if (!created.ok) throw new Error('rule');
    const { ruleId } = created.value;

    expect(generateDueOccurrences(t.ctx, device, '2026-10-10')).toBe(3);
    expect(generateDueOccurrences(t.ctx, device, '2026-10-10')).toBe(0);

    const ids = t.ctx.db.select().from(expenses).where(eq(expenses.recurringRuleId, ruleId)).all();
    expect(ids.map((e) => e.expenseDate).sort()).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ]);
    expect(ids.map((e) => e.id).sort()).toEqual(
      ['2026-08-01', '2026-09-01', '2026-10-01'].map((d) => occurrenceId(ruleId, d)).sort(),
    );
    const oct = getExpense(t.ctx.db, occurrenceId(ruleId, '2026-10-01'))!;
    expect(oct.shares.map((s) => s.amountPaise)).toEqual([1_000_000, 1_000_000, 1_000_000]);
    expect(isPristineOccurrence(oct.expense)).toBe(true);

    const log = t.ctx.db
      .select()
      .from(activityLog)
      .where(eq(activityLog.id, occurrenceActivityId(ruleId, '2026-10-01')))
      .get();
    expect(log).toMatchObject({ actorMemberId: null, entityId: oct.expense.id });
  });

  it('never re-creates an occurrence that was deleted', () => {
    const g = setup();
    const created = createRule(t.ctx, rent(g, { startDate: '2026-10-01' }));
    if (!created.ok) throw new Error('rule');
    generateDueOccurrences(t.ctx, device, '2026-10-10');
    const id = occurrenceId(created.value.ruleId, '2026-10-01');
    t.ctx.db.update(expenses).set({ deletedAt: 5 }).where(eq(expenses.id, id)).run();
    expect(generateDueOccurrences(t.ctx, device, '2026-10-10')).toBe(0);
  });

  it('applies edits to future occurrences and fixes the schedule once one exists', () => {
    const g = setup();
    const created = createRule(t.ctx, rent(g, { startDate: '2026-10-01' }));
    if (!created.ok) throw new Error('rule');
    const { ruleId } = created.value;
    generateDueOccurrences(t.ctx, device, '2026-10-10');

    expect(
      updateRule(
        t.ctx,
        ruleId,
        rent(g, {
          startDate: '2026-10-01',
          amountPaise: 3_300_000,
          payers: [{ memberId: g.me, amountPaise: 3_300_000 }],
        }),
      ).ok,
    ).toBe(true);
    expect(updateRule(t.ctx, ruleId, rent(g, { startDate: '2026-10-05' }))).toEqual({
      ok: false,
      error: { code: 'SCHEDULE_LOCKED' },
    });

    generateDueOccurrences(t.ctx, device, '2026-11-02');
    expect(getExpense(t.ctx.db, occurrenceId(ruleId, '2026-10-01'))!.expense.amountPaise).toBe(
      3_000_000,
    );
    expect(getExpense(t.ctx.db, occurrenceId(ruleId, '2026-11-01'))!.expense.amountPaise).toBe(
      3_300_000,
    );
  });

  it('stops when deleted or ended', () => {
    const g = setup();
    const ended = createRule(t.ctx, rent(g, { endDate: '2026-08-31' }));
    if (!ended.ok) throw new Error('rule');
    expect(generateDueOccurrences(t.ctx, device, '2026-12-01')).toBe(1);

    const wifi = createRule(t.ctx, rent(g, { description: 'Wi-Fi', startDate: '2026-11-01' }));
    if (!wifi.ok) throw new Error('rule');
    expect(deleteRule(t.ctx, wifi.value.ruleId, g.me).ok).toBe(true);
    expect(generateDueOccurrences(t.ctx, device, '2026-12-01')).toBe(0);
  });

  it('pauses while someone on the rule has left the group', () => {
    const g = setup(); // fresh group: nobody owes anything, so Priya can leave
    const maid = createRule(t.ctx, rent(g, { description: 'Maid', startDate: '2026-12-01' }));
    if (!maid.ok) throw new Error('rule');
    expect(removeMember(t.ctx, { memberId: g.priya, actorMemberId: g.me }).ok).toBe(true);
    const rule = groupRulesQuery(t.ctx.db, g.groupId).all()[0]!;
    expect(ruleProblem(t.ctx.db, rule)).toBe('MEMBER_LEFT');
    expect(generateDueOccurrences(t.ctx, device, '2026-12-02')).toBe(0);
  });

  it('validates like an expense and checks the schedule', () => {
    const g = setup();
    expect(createRule(t.ctx, rent(g, { frequency: 'daily' as never }))).toEqual({
      ok: false,
      error: { code: 'SCHEDULE', error: 'INVALID_FREQUENCY' },
    });
    expect(createRule(t.ctx, rent(g, { endDate: '2026-07-01' }))).toEqual({
      ok: false,
      error: { code: 'SCHEDULE', error: 'END_BEFORE_START' },
    });
    expect(createRule(t.ctx, rent(g, { timeZone: 'not a zone!' }))).toEqual({
      ok: false,
      error: { code: 'INVALID_TIME_ZONE' },
    });
    expect(createRule(t.ctx, rent(g, { payers: [{ memberId: g.me, amountPaise: 1 }] })).ok).toBe(
      false,
    );
  });

  it('lets the first occurrence be the expense being saved', () => {
    const g = setup();
    const created = createRule(t.ctx, rent(g, { startDate: '2026-10-01' }));
    if (!created.ok) throw new Error('rule');
    const first = createExpense(t.ctx, {
      groupId: g.groupId,
      description: 'Rent',
      amountPaise: 3_000_000,
      expenseDate: '2026-10-01',
      payers: [{ memberId: g.me, amountPaise: 3_000_000 }],
      splitInput: { type: 'equal', memberIds: [g.me, g.rahul, g.priya] },
      actorMemberId: g.me,
      recurring: { ruleId: created.value.ruleId, occurrenceDate: '2026-10-01' },
    });
    if (!first.ok) throw new Error('expense');
    expect(first.value.expenseId).toBe(occurrenceId(created.value.ruleId, '2026-10-01'));
    expect(generateDueOccurrences(t.ctx, device, '2026-10-10')).toBe(0);
  });
});
