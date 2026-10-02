import { createExpense } from '../repositories/expenses';
import { activeGroupsQuery, createGroup, deleteGroup, getGroup } from '../repositories/groups';
import { activeMembersQuery } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import { recordSettlement } from '../repositories/settlements';
import { groups, members } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function setupWithDebt() {
  const created = createGroup(t.ctx, {
    name: 'Trip',
    selfName: 'Asha',
    otherMemberNames: ['Rahul'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error('group failed');
  const { groupId, selfMemberId: me } = created.value;
  const rahul = activeMembersQuery(t.ctx.db, groupId)
    .all()
    .find((m) => m.displayName === 'Rahul')!.id;

  // Asha paid ₹600 for both -> Rahul owes ₹300.
  createExpense(t.ctx, {
    groupId,
    description: 'Dinner',
    amountPaise: 60000,
    expenseDate: '2026-10-01',
    payers: [{ memberId: me, amountPaise: 60000 }],
    splitInput: { type: 'equal', memberIds: [me, rahul] },
    actorMemberId: me,
  });
  return { groupId, me, rahul };
}

describe('deleteGroup', () => {
  it('blocks deletion while anyone has a balance', () => {
    const g = setupWithDebt();
    expect(deleteGroup(t.ctx, { groupId: g.groupId, actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'UNSETTLED_BALANCES', count: 2 },
    });
  });

  it('deletes a settled group and hides it from the list', () => {
    const g = setupWithDebt();
    recordSettlement(t.ctx, {
      groupId: g.groupId,
      fromMemberId: g.rahul,
      toMemberId: g.me,
      amountPaise: 30000,
      method: 'upi',
      actorMemberId: g.me,
    });

    expect(deleteGroup(t.ctx, { groupId: g.groupId, actorMemberId: g.me })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(getGroup(t.ctx.db, g.groupId)).toBeNull();
    expect(activeGroupsQuery(t.ctx.db).all()).toHaveLength(0);
    expect(deleteGroup(t.ctx, { groupId: g.groupId, actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'GROUP_NOT_FOUND' },
    });
  });

  it('rejects a non-member actor', () => {
    const g = setupWithDebt();
    expect(deleteGroup(t.ctx, { groupId: g.groupId, actorMemberId: 'stranger' })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
  });

  it('lets you delete a leftover group with no account-linked members', () => {
    t.ctx.db.insert(groups).values({ id: 'orphan', name: 'Test group 1' }).run();
    t.ctx.db.insert(members).values({ id: 'ph', groupId: 'orphan', displayName: 'Placeholder' }).run();
    expect(deleteGroup(t.ctx, { groupId: 'orphan', actorMemberId: null })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('refuses actor-less deletion when someone in the group has an account', () => {
    const g = setupWithDebt();
    expect(deleteGroup(t.ctx, { groupId: g.groupId, actorMemberId: null })).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });
  });
});