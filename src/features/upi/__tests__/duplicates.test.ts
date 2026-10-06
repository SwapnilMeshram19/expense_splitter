import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createGroup } from '@/db/repositories/groups';
import { activeMembersQuery } from '@/db/repositories/members';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { deleteSettlement, getSettlement, recordSettlement } from '@/db/repositories/settlements';

import { DUPLICATE_WINDOW_MS, isRecentDuplicate } from '../duplicates';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

it('finds same-direction, same-amount payments inside the window only', () => {
  const created = createGroup(t.ctx, {
    name: 'Trip',
    selfName: 'Asha',
    otherMemberNames: ['Rahul'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error('group failed');
  const { groupId, selfMemberId: me } = created.value;
  const rahul = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Rahul')!.id;

  const result = recordSettlement(t.ctx, {
    groupId,
    fromMemberId: rahul,
    toMemberId: me,
    amountPaise: 30000,
    method: 'upi',
    actorMemberId: me,
  });
  if (!result.ok) throw new Error('record failed');
  const createdAt = getSettlement(t.ctx.db, result.value.settlementId)!.createdAt;

  expect(isRecentDuplicate(t.ctx.db, groupId, rahul, me, 30000, createdAt + 1000)).toBe(true);
  expect(isRecentDuplicate(t.ctx.db, groupId, me, rahul, 30000, createdAt + 1000)).toBe(false); // other direction
  expect(isRecentDuplicate(t.ctx.db, groupId, rahul, me, 29999, createdAt + 1000)).toBe(false);
  expect(isRecentDuplicate(t.ctx.db, groupId, rahul, me, 30000, createdAt + DUPLICATE_WINDOW_MS + 1)).toBe(false);

  deleteSettlement(t.ctx, result.value.settlementId, me);
  expect(isRecentDuplicate(t.ctx.db, groupId, rahul, me, 30000, createdAt + 1000)).toBe(false);
});