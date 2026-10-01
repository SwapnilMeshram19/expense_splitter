import { eq } from 'drizzle-orm';

import { computeBalances } from '@/domain/balances';
import { MAX_AMOUNT_PAISE } from '@/domain/money';

import { createExpense } from '../repositories/expenses';
import { createGroup } from '../repositories/groups';
import { loadGroupLedger } from '../repositories/ledger';
import { activeMembersQuery } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import {
  deleteSettlement,
  getSettlement,
  MAX_NOTE_LENGTH,
  recordSettlement,
  type SettlementDraft,
} from '../repositories/settlements';
import { activityLog } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Trip',
    selfName: 'Asha',
    otherMemberNames: ['Rahul', 'Priya'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error('group failed');
  const { groupId, selfMemberId: me } = created.value;
  const rows = activeMembersQuery(t.ctx.db, groupId).all();
  const idOf = (name: string) => rows.find((m) => m.displayName === name)!.id;
  const rahul = idOf('Rahul');
  const priya = idOf('Priya');

  // Asha paid ₹900 for all three -> Rahul and Priya owe ₹300 each.
  const expense = createExpense(t.ctx, {
    groupId,
    description: 'Dinner',
    amountPaise: 90000,
    expenseDate: '2026-10-01',
    payers: [{ memberId: me, amountPaise: 90000 }],
    splitInput: { type: 'equal', memberIds: [me, rahul, priya] },
    actorMemberId: me,
  });
  if (!expense.ok) throw new Error('expense failed');

  return { groupId, me, rahul, priya };
}

type Setup = ReturnType<typeof setup>;

const payment = (g: Setup, patch: Partial<SettlementDraft> = {}): SettlementDraft => ({
  groupId: g.groupId,
  fromMemberId: g.rahul,
  toMemberId: g.me,
  amountPaise: 30000,
  method: 'upi',
  actorMemberId: g.me,
  ...patch,
});

const balancesOf = (groupId: string) => {
  const ledger = loadGroupLedger(t.ctx.db, groupId);
  return computeBalances(ledger.expenses, ledger.settlements).balances;
};

describe('settlements', () => {
  it('records a payment and updates balances', () => {
    const g = setup();
    const result = recordSettlement(t.ctx, payment(g, { note: '  for   dinner ' }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));

    const balances = balancesOf(g.groupId);
    expect(balances.get(g.rahul)).toBe(0);
    expect(balances.get(g.me)).toBe(30000);
    expect(balances.get(g.priya)).toBe(-30000);

    const row = getSettlement(t.ctx.db, result.value.settlementId);
    expect(row?.note).toBe('for dinner');
    expect(row?.dirty).toBe(true);
    expect(row?.version).toBe(0);
  });

  it('allows partial payments and overpayments', () => {
    const g = setup();
    expect(recordSettlement(t.ctx, payment(g, { amountPaise: 10000 })).ok).toBe(true);
    expect(balancesOf(g.groupId).get(g.rahul)).toBe(-20000);

    expect(recordSettlement(t.ctx, payment(g, { amountPaise: 50000 })).ok).toBe(true);
    expect(balancesOf(g.groupId).get(g.rahul)).toBe(30000);
  });

  it('lets any member record a payment between two others', () => {
    const g = setup();
    expect(recordSettlement(t.ctx, payment(g, { toMemberId: g.priya, actorMemberId: g.me })).ok).toBe(true);
  });

  it.each<[string, (g: Setup) => Partial<SettlementDraft>, object]>([
    ['same person', (g) => ({ toMemberId: g.rahul }), { code: 'SAME_PERSON' }],
    ['zero amount', () => ({ amountPaise: 0 }), { code: 'INVALID_AMOUNT' }],
    ['fractional amount', () => ({ amountPaise: 10.5 }), { code: 'INVALID_AMOUNT' }],
    ['amount above cap', () => ({ amountPaise: MAX_AMOUNT_PAISE + 1 }), { code: 'INVALID_AMOUNT' }],
    ['unknown member', () => ({ toMemberId: 'stranger' }), { code: 'UNKNOWN_MEMBER', memberId: 'stranger' }],
    ['actor not a member', () => ({ actorMemberId: 'stranger' }), { code: 'NOT_A_MEMBER' }],
    ['long note', () => ({ note: 'x'.repeat(MAX_NOTE_LENGTH + 1) }), { code: 'NOTE_TOO_LONG', max: MAX_NOTE_LENGTH }],
  ])('rejects %s', (_label, patch, expected) => {
    const g = setup();
    expect(recordSettlement(t.ctx, payment(g, patch(g)))).toEqual({ ok: false, error: expected });
  });

  it('soft-deletes a payment, restores balances and logs both actions', () => {
    const g = setup();
    const result = recordSettlement(t.ctx, payment(g));
    if (!result.ok) throw new Error('record failed');
    const id = result.value.settlementId;

    expect(deleteSettlement(t.ctx, id, g.me)).toEqual({ ok: true, value: undefined });
    expect(balancesOf(g.groupId).get(g.rahul)).toBe(-30000);
    expect(deleteSettlement(t.ctx, id, g.me)).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });

    const log = t.ctx.db.select().from(activityLog).where(eq(activityLog.entityId, id)).all();
    expect(log.map((l) => l.action).sort()).toEqual(['create', 'delete']);
  });
});