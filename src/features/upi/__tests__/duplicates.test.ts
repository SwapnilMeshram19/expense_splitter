import { testGroup } from '@/test-utils/groupBuilder';

import { DUPLICATE_WINDOW_MS, isRecentDuplicate } from '../duplicates';

it('finds same-direction, same-amount payments inside the window only', () => {
  const g = testGroup({ me: 'Asha', others: ['Rahul'] });
  const me = g.me;
  const rahul = g.member('Rahul');
  const id = g.run('settlement.add', {
    id: g.newId(),
    fromMemberId: rahul,
    toMemberId: me,
    amountPaise: 30000,
    method: 'upi',
  });
  const createdAt = g.snapshot().settlements.find((s) => s.id === id)!.createdAt;
  const check = (from: string, to: string, amount: number, now: number) =>
    isRecentDuplicate(g.snapshot(), from, to, amount, now);

  expect(check(rahul, me, 30000, createdAt + 1000)).toBe(true);
  expect(check(me, rahul, 30000, createdAt + 1000)).toBe(false); // other direction
  expect(check(rahul, me, 29999, createdAt + 1000)).toBe(false);
  expect(check(rahul, me, 30000, createdAt + DUPLICATE_WINDOW_MS + 1)).toBe(false);
  expect(isRecentDuplicate(null, rahul, me, 30000, createdAt)).toBe(false);

  g.run('settlement.delete', { settlementId: id, expectedVersion: g.versionOf(id) });
  expect(check(rahul, me, 30000, createdAt + 1000)).toBe(false);
});
