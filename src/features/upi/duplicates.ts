import type { AppDb } from '@/db/context';
import { groupSettlementsQuery } from '@/db/repositories/settlements';

export const DUPLICATE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Same payer, receiver and amount recorded recently: the other side may have recorded it already. */
export function isRecentDuplicate(
  db: AppDb,
  groupId: string,
  fromMemberId: string,
  toMemberId: string,
  amountPaise: number,
  now: number = Date.now(),
): boolean {
  return groupSettlementsQuery(db, groupId)
    .all()
    .some(
      (s) =>
        s.fromMemberId === fromMemberId &&
        s.toMemberId === toMemberId &&
        s.amountPaise === amountPaise &&
        now - s.createdAt < DUPLICATE_WINDOW_MS,
    );
}