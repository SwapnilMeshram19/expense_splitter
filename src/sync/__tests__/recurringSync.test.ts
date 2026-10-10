import { eq } from 'drizzle-orm';

import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { getExpense } from '@/db/repositories/expenses';
import { createGroup } from '@/db/repositories/groups';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { createRule, generateDueOccurrences } from '@/db/repositories/recurring';
import { expenses, recurringRules } from '@/db/schema';
import { occurrenceId } from '@/domain/recurrence';

import { applyPull, applyPushResult, collectPushBatch, getSyncIssues } from '../engine';
import { getRefetchGroupIds } from '../issueActions';
import {
  expenseToWire,
  ruleToWire,
  type Incoming,
  type PullResult,
  type WireExpense,
} from '../wire';

let t: TestContext;
let device: string;
beforeEach(() => {
  t = createTestContext();
  device = getOrCreateDeviceUserId(t.ctx);
});
afterEach(() => t.close());

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Flat',
    selfName: 'Asha',
    otherMemberNames: [],
    deviceUserId: device,
  });
  if (!created.ok) throw new Error('group');
  const { groupId, selfMemberId: me } = created.value;
  const rule = createRule(t.ctx, {
    groupId,
    description: 'Rent',
    amountPaise: 2_000_000,
    payers: [{ memberId: me, amountPaise: 2_000_000 }],
    splitInput: { type: 'equal', memberIds: [me] },
    frequency: 'monthly',
    startDate: '2026-10-01',
    endDate: null,
    timeZone: 'Asia/Kolkata',
    actorMemberId: me,
  });
  if (!rule.ok) throw new Error(JSON.stringify(rule.error));
  return { groupId, me, ruleId: rule.value.ruleId };
}

const emptyPull = (groupIds: string[]): PullResult => ({
  cursor: '9',
  more: false,
  group_ids: groupIds,
  groups: [],
  members: [],
  expenses: [],
  settlements: [],
  recurring_rules: [],
  activity: [],
});

describe('recurring rules sync', () => {
  it('pushes rules with their computed lines and the group currency', () => {
    const { ruleId } = setup();
    const collected = collectPushBatch(t.ctx)!;
    expect(collected.batch.recurring_rules).toEqual([
      expect.objectContaining({
        id: ruleId,
        frequency: 'monthly',
        start_date: '2026-10-01',
        time_zone: 'Asia/Kolkata',
        group_currency: 'INR',
        base_version: 0,
        shares: [expect.objectContaining({ amount_paise: 2_000_000 })],
      }),
    ]);
  });

  it('takes a rule from a pull', () => {
    const { groupId, ruleId } = setup();
    const local = t.ctx.db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, ruleId))
      .get()!;
    t.ctx.db.update(recurringRules).set({ dirty: false, version: 1 }).run();
    const pull = emptyPull([groupId]);
    pull.recurring_rules = [
      { ...ruleToWire(local), description: 'Rent (new flat)', amount_paise: 2_500_000, version: 2 },
    ];
    applyPull(t.ctx, pull);
    expect(
      t.ctx.db.select().from(recurringRules).where(eq(recurringRules.id, ruleId)).get(),
    ).toMatchObject({
      description: 'Rent (new flat)',
      amountPaise: 2_500_000,
      version: 2,
      dirty: false,
    });
  });

  it('quietly takes the server copy when an untouched occurrence already exists there (push)', () => {
    const { groupId, ruleId } = setup();
    generateDueOccurrences(t.ctx, device, '2026-10-05');
    const id = occurrenceId(ruleId, '2026-10-01');
    const collected = collectPushBatch(t.ctx)!;

    applyPushResult(t.ctx, collected, {
      applied: [],
      conflicts: [{ table: 'expenses', id, server_version: 3 }],
      rejected: [],
    });
    expect(getSyncIssues(t.ctx)).toEqual([]);
    expect(getExpense(t.ctx.db, id)!.expense).toMatchObject({ dirty: false, version: 0 });
    expect(getRefetchGroupIds(t.ctx)).toContain(groupId);
  });

  it('quietly takes the server copy when one arrives in a pull before the push', () => {
    const { groupId, ruleId } = setup();
    generateDueOccurrences(t.ctx, device, '2026-10-05');
    const id = occurrenceId(ruleId, '2026-10-01');
    const detail = getExpense(t.ctx.db, id)!;
    const server: Incoming<WireExpense> = {
      ...expenseToWire(detail.expense, detail.payers, detail.shares),
      created_at: 1, // the server made it at another moment
      updated_at: 1,
      version: 1,
    };
    applyPull(t.ctx, { ...emptyPull([groupId]), expenses: [server] });
    expect(getSyncIssues(t.ctx)).toEqual([]);
    expect(getExpense(t.ctx.db, id)!.expense).toMatchObject({
      dirty: false,
      version: 1,
      createdAt: 1,
    });
  });

  it('still asks when the occurrence was edited here', () => {
    const { ruleId } = setup();
    generateDueOccurrences(t.ctx, device, '2026-10-05');
    const id = occurrenceId(ruleId, '2026-10-01');
    t.ctx.db
      .update(expenses)
      .set({ description: 'Rent + maintenance', updatedAt: 999_999_999_999 })
      .where(eq(expenses.id, id))
      .run();
    const collected = collectPushBatch(t.ctx)!;
    applyPushResult(t.ctx, collected, {
      applied: [],
      conflicts: [{ table: 'expenses', id, server_version: 3 }],
      rejected: [],
    });
    expect(getSyncIssues(t.ctx)).toEqual([
      expect.objectContaining({ kind: 'conflict', table: 'expenses', id }),
    ]);
  });
});
