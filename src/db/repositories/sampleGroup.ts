import { eq, inArray } from 'drizzle-orm';

import { DEFAULT_CURRENCY } from '@/domain/currency';
import { fromIsoDate, toLocalIsoDate } from '@/lib/dates';
import { err, ok, type Result } from '@/lib/result';

import type { RepoContext } from '../context';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  receiptFiles,
  recurringRules,
  settings,
  settlements,
  type ExpenseCategory,
  type StoredSplitInput,
} from '../schema';
import { createExpense } from './expenses';
import { createGroup } from './groups';
import { activeMembersQuery } from './members';
import { getSetting, SELF_NAME_KEY, setSetting } from './profile';
import { SAMPLE_GROUP_IDS_KEY, sampleGroupIds } from './sampleIds';
import { recordSettlement } from './settlements';

export { isSampleGroup, SAMPLE_GROUP_IDS_KEY, sampleGroupIds } from './sampleIds';

/** Set once the example was offered (created, or skipped because real groups exist). Never reset. */
export const SAMPLE_SEEDED_KEY = 'sample_seeded';

export const SAMPLE_GROUP_NAME = 'Goa trip · example';
const FRIENDS = ['Rahul', 'Priya', 'Aman'] as const;
type Friend = (typeof FRIENDS)[number];
type Who = 'me' | Friend;

interface SampleExpense {
  description: string;
  /** Rupees (the example is always in INR). */
  rupees: number;
  category: ExpenseCategory;
  daysAgo: number;
  paidBy: Who;
  split:
    | { type: 'equal'; among: readonly Who[] }
    | { type: 'exact'; rupees: Partial<Record<Who, number>> }
    | { type: 'shares'; units: Partial<Record<Who, number>> };
  note?: string;
}

const EVERYONE: readonly Who[] = ['me', ...FRIENDS];

/**
 * A long weekend in Goa: one of each split type, a payment, and an outcome worth reading
 * ("you're owed ₹4,000"). Kept small so the group screen fits without scrolling much.
 */
export const SAMPLE_EXPENSES: readonly SampleExpense[] = [
  {
    description: 'Beach villa, 2 nights',
    rupees: 12_000,
    category: 'stay',
    daysAgo: 6,
    paidBy: 'me',
    split: { type: 'equal', among: EVERYONE },
    note: 'This is an example. Edit or delete anything here: it stays on your phone and is never shared.',
  },
  {
    description: 'Dinner at the beach shack',
    rupees: 3_200,
    category: 'food',
    daysAgo: 5,
    paidBy: 'Rahul',
    split: { type: 'equal', among: EVERYONE },
  },
  {
    description: 'Scooty rent',
    rupees: 1_500,
    category: 'transport',
    daysAgo: 5,
    paidBy: 'Priya',
    // Aman didn't ride: split equally between the other three.
    split: { type: 'equal', among: ['me', 'Rahul', 'Priya'] },
  },
  {
    description: 'Water sports',
    rupees: 6_000,
    category: 'entertainment',
    daysAgo: 4,
    paidBy: 'Rahul',
    split: { type: 'exact', rupees: { me: 2_000, Rahul: 2_000, Priya: 2_000 } },
  },
  {
    description: 'Groceries for the villa',
    rupees: 1_800,
    category: 'groceries',
    daysAgo: 4,
    paidBy: 'Aman',
    // Shares: Aman and Rahul ate in more.
    split: { type: 'shares', units: { me: 1, Rahul: 2, Priya: 1, Aman: 2 } },
  },
  {
    description: 'Cab to the airport',
    rupees: 2_400,
    category: 'travel',
    daysAgo: 3,
    paidBy: 'Aman',
    split: { type: 'equal', among: EVERYONE },
  },
];

/** Aman already paid you back: he's square, Priya still owes. */
const SAMPLE_PAYMENT = { from: 'Aman' as Who, to: 'me' as Who, rupees: 800 };

const daysBefore = (today: string, days: number): string => {
  const d = fromIsoDate(today);
  d.setDate(d.getDate() - days);
  return toLocalIsoDate(d);
};

/** Wraps a context so its next newId() returns `first`: the group gets an id we know in advance. */
function withFirstId(ctx: RepoContext, first: string): RepoContext {
  let used = false;
  return {
    ...ctx,
    newId: () => {
      if (used) return ctx.newId();
      used = true;
      return first;
    },
  };
}

/**
 * Creates the example group on a phone that has never had a group, once. Returns its id, or null
 * when nothing was created (already offered, or this phone already has groups).
 *
 * Safety: the group's id is written to the sample list BEFORE any of its rows exist, so even a
 * crash halfway leaves nothing the sync engine would push.
 */
export function seedSampleGroupIfNew(
  ctx: RepoContext,
  input: { deviceUserId: string; today: string },
): string | null {
  if (getSetting(ctx, SAMPLE_SEEDED_KEY)) return null;
  setSetting(ctx, SAMPLE_SEEDED_KEY, '1');
  // Any group at all, even a deleted one: this isn't a new user.
  if (ctx.db.select({ id: groups.id }).from(groups).limit(1).get()) return null;

  const groupId = ctx.newId();
  setSetting(ctx, SAMPLE_GROUP_IDS_KEY, JSON.stringify([...sampleGroupIds(ctx.db), groupId]));

  const created = createGroup(withFirstId(ctx, groupId), {
    name: SAMPLE_GROUP_NAME,
    selfName: getSetting(ctx, SELF_NAME_KEY)?.trim() || 'You',
    otherMemberNames: [...FRIENDS],
    deviceUserId: input.deviceUserId,
    currency: DEFAULT_CURRENCY,
  });
  if (!created.ok) return null;
  const me = created.value.selfMemberId;
  const idOf = new Map<Who, string>([['me', me]]);
  for (const m of activeMembersQuery(ctx.db, groupId).all()) {
    if ((FRIENDS as readonly string[]).includes(m.displayName)) idOf.set(m.displayName as Friend, m.id);
  }
  const id = (who: Who) => idOf.get(who)!;
  const paise = (rupees: number) => Math.round(rupees * 100);

  for (const e of SAMPLE_EXPENSES) {
    const total = paise(e.rupees);
    let splitInput: StoredSplitInput;
    if (e.split.type === 'equal') {
      splitInput = { type: 'equal', memberIds: e.split.among.map(id) };
    } else if (e.split.type === 'exact') {
      splitInput = {
        type: 'exact',
        entries: Object.entries(e.split.rupees).map(([who, r]) => ({ memberId: id(who as Who), value: paise(r!) })),
      };
    } else {
      splitInput = {
        type: 'shares',
        entries: Object.entries(e.split.units).map(([who, u]) => ({ memberId: id(who as Who), value: u! })),
      };
    }
    createExpense(ctx, {
      groupId,
      description: e.description,
      amountPaise: total,
      category: e.category,
      expenseDate: daysBefore(input.today, e.daysAgo),
      payers: [{ memberId: id(e.paidBy), amountPaise: total }],
      splitInput,
      note: e.note ?? null,
      actorMemberId: me,
    });
  }
  recordSettlement(ctx, {
    groupId,
    fromMemberId: id(SAMPLE_PAYMENT.from),
    toMemberId: id(SAMPLE_PAYMENT.to),
    amountPaise: paise(SAMPLE_PAYMENT.rupees),
    method: 'upi',
    actorMemberId: me,
  });
  return groupId;
}

export type RemoveSampleError = { code: 'NOT_SAMPLE' };

/**
 * Deletes an example group and everything in it, from this phone (it was never anywhere else).
 * Returns the ids of receipt photos taken in it, for the caller to delete from storage.
 */
export function removeSampleGroup(ctx: RepoContext, groupId: string): Result<{ receiptIds: string[] }, RemoveSampleError> {
  const ids = sampleGroupIds(ctx.db);
  if (!ids.has(groupId)) return err({ code: 'NOT_SAMPLE' });
  ids.delete(groupId);

  const receiptIds = ctx.db
    .select({ id: receiptFiles.receiptId })
    .from(receiptFiles)
    .where(eq(receiptFiles.groupId, groupId))
    .all()
    .map((r) => r.id);

  ctx.db.transaction((tx) => {
    const groupExpenses = tx.select({ id: expenses.id }).from(expenses).where(eq(expenses.groupId, groupId));
    tx.delete(expensePayers).where(inArray(expensePayers.expenseId, groupExpenses)).run();
    tx.delete(expenseShares).where(inArray(expenseShares.expenseId, groupExpenses)).run();
    tx.delete(receiptFiles).where(eq(receiptFiles.groupId, groupId)).run();
    tx.delete(expenses).where(eq(expenses.groupId, groupId)).run();
    tx.delete(settlements).where(eq(settlements.groupId, groupId)).run();
    tx.delete(activityLog).where(eq(activityLog.groupId, groupId)).run();
    tx.delete(recurringRules).where(eq(recurringRules.groupId, groupId)).run();
    tx.delete(members).where(eq(members.groupId, groupId)).run();
    tx.delete(groups).where(eq(groups.id, groupId)).run();
    const value = JSON.stringify([...ids]);
    tx.insert(settings)
      .values({ key: SAMPLE_GROUP_IDS_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  });
  return ok({ receiptIds });
}

/** For the Home and Settle totals: example balances only count while it's the only group. */
export const countsInTotals = (isSample: boolean, hasRealGroups: boolean): boolean => !isSample || !hasRealGroups;
