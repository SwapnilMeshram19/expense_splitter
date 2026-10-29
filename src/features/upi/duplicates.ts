import type { GroupSnapshot } from '@/domain/model';

export const DUPLICATE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Same payer, receiver and amount recorded recently: the other side may have recorded it already. */
export function isRecentDuplicate(
  snapshot: GroupSnapshot | null,
  fromMemberId: string,
  toMemberId: string,
  amountPaise: number,
  now: number = Date.now(),
): boolean {
  return (snapshot?.settlements ?? []).some(
    (s) =>
      s.fromMemberId === fromMemberId &&
      s.toMemberId === toMemberId &&
      s.amountPaise === amountPaise &&
      now - s.createdAt < DUPLICATE_WINDOW_MS,
  );
}
