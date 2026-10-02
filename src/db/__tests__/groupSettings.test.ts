import { computeBalances } from '@/domain/balances';

import { createExpense } from '../repositories/expenses';
import { createGroup, getGroup, renameGroup, setSimplifyDebts } from '../repositories/groups';
import { loadGroupLedger } from '../repositories/ledger';
import { activeMembersQuery, addMember, removeMember } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import { recordSettlement } from '../repositories/settlements';
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

describe('group settings', () => {
  it('renames a group with normalization and access checks', () => {
    const g = setup();
    expect(renameGroup(t.ctx, { groupId: g.groupId, name: '  Goa   2026 ', actorMemberId: g.me })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(getGroup(t.ctx.db, g.groupId)?.name).toBe('Goa 2026');

    expect(renameGroup(t.ctx, { groupId: g.groupId, name: ' ', actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'NAME_REQUIRED' },
    });
    expect(renameGroup(t.ctx, { groupId: g.groupId, name: 'X', actorMemberId: 'stranger' })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
    expect(renameGroup(t.ctx, { groupId: 'missing', name: 'X', actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'GROUP_NOT_FOUND' },
    });
  });

  it('toggles debt simplification', () => {
    const g = setup();
    expect(getGroup(t.ctx.db, g.groupId)?.simplifyDebts).toBe(true);
    setSimplifyDebts(t.ctx, { groupId: g.groupId, simplifyDebts: false, actorMemberId: g.me });
    expect(getGroup(t.ctx.db, g.groupId)?.simplifyDebts).toBe(false);
  });
});

describe('removing members', () => {
  it('blocks removal while the member has a balance', () => {
    const g = setup();
    expect(removeMember(t.ctx, { memberId: g.rahul, actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'MEMBER_HAS_BALANCE', balancePaise: -30000 },
    });
  });

  it('removes a settled member while keeping history and balances intact', () => {
    const g = setup();
    const settled = recordSettlement(t.ctx, {
      groupId: g.groupId,
      fromMemberId: g.rahul,
      toMemberId: g.me,
      amountPaise: 30000,
      method: 'cash',
      actorMemberId: g.me,
    });
    expect(settled.ok).toBe(true);

    expect(removeMember(t.ctx, { memberId: g.rahul, actorMemberId: g.me })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(activeMembersQuery(t.ctx.db, g.groupId).all().map((m) => m.displayName)).toEqual([
      'Asha',
      'Priya',
    ]);

    // The old expense still references Rahul; balances are unaffected.
    const ledger = loadGroupLedger(t.ctx.db, g.groupId);
    const { balances, invalidIds } = computeBalances(ledger.expenses, ledger.settlements);
    expect(invalidIds).toEqual([]);
    expect(balances.get(g.rahul)).toBe(0);
    expect(balances.get(g.priya)).toBe(-30000);
  });

  it('does not let you remove yourself', () => {
    const g = setup();
    expect(removeMember(t.ctx, { memberId: g.me, actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'CANNOT_REMOVE_SELF' },
    });
  });

  it('allows re-adding a removed name as a new member', () => {
    const g = setup();
    recordSettlement(t.ctx, {
      groupId: g.groupId,
      fromMemberId: g.rahul,
      toMemberId: g.me,
      amountPaise: 30000,
      method: 'cash',
      actorMemberId: g.me,
    });
    removeMember(t.ctx, { memberId: g.rahul, actorMemberId: g.me });

    const readded = addMember(t.ctx, { groupId: g.groupId, displayName: 'Rahul', actorMemberId: g.me });
    expect(readded.ok).toBe(true);
    if (readded.ok) expect(readded.value.memberId).not.toBe(g.rahul);
  });
});