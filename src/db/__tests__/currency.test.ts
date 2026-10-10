import { eq } from 'drizzle-orm';

import { applyPull, collectPushBatch, applyPushResult } from '@/sync/engine';
import {
  expenseToWire,
  sameContent,
  type Incoming,
  type PullResult,
  type WireExpense,
} from '@/sync/wire';

import { loadGroupLedger } from '../repositories/ledger';
import {
  createExpense,
  getExpense,
  groupBillCurrencies,
  updateExpense,
  type ExpenseDraft,
} from '../repositories/expenses';
import {
  createGroup,
  groupCurrency,
  isCurrencyLocked,
  setGroupCurrency,
} from '../repositories/groups';
import { activeMembersQuery } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import { deleteSettlement, recordSettlement } from '../repositories/settlements';
import { activityLog, expensePayers, expenses, groups } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;
beforeEach(() => {
  t = createTestContext();
});
afterEach(() => t.close());

function setup(currency?: string) {
  const created = createGroup(t.ctx, {
    name: 'Dubai',
    selfName: 'Asha',
    otherMemberNames: ['Rahul', 'Priya'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
    ...(currency ? { currency } : {}),
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const { groupId, selfMemberId: me } = created.value;
  const all = activeMembersQuery(t.ctx.db, groupId).all();
  const rahul = all.find((m) => m.displayName === 'Rahul')!.id;
  const priya = all.find((m) => m.displayName === 'Priya')!.id;
  return { groupId, me, rahul, priya };
}

describe('group currency', () => {
  it('defaults to INR and stores the chosen currency', () => {
    expect(groupCurrency(t.ctx.db, setup().groupId)).toBe('INR');
    expect(groupCurrency(t.ctx.db, setup('AED').groupId)).toBe('AED');
    expect(groupCurrency(t.ctx.db, 'missing')).toBe('INR');
  });

  it('rejects unknown currencies', () => {
    const result = createGroup(t.ctx, {
      name: 'X',
      selfName: 'Asha',
      otherMemberNames: [],
      deviceUserId: 'u',
      currency: 'XYZ',
    });
    expect(result).toEqual({
      ok: false,
      error: { target: 'currency', error: { code: 'UNKNOWN_CURRENCY' } },
    });
  });

  it('can change until the first expense or payment, then locks (also after deletes)', () => {
    const { groupId, me, rahul } = setup();
    expect(setGroupCurrency(t.ctx, { groupId, currency: 'USD', actorMemberId: me })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(groupCurrency(t.ctx.db, groupId)).toBe('USD');
    expect(t.ctx.db.select().from(groups).where(eq(groups.id, groupId)).get()?.dirty).toBe(true);
    const log = t.ctx.db.select().from(activityLog).all().at(-1);
    expect(log?.before).toEqual({ currency: 'INR' });
    expect(log?.after).toEqual({ currency: 'USD' });

    // Same value: no-op. Unknown: refused.
    expect(setGroupCurrency(t.ctx, { groupId, currency: 'USD', actorMemberId: me }).ok).toBe(true);
    expect(setGroupCurrency(t.ctx, { groupId, currency: 'XYZ', actorMemberId: me })).toEqual({
      ok: false,
      error: { code: 'UNKNOWN_CURRENCY' },
    });
    expect(
      setGroupCurrency(t.ctx, { groupId, currency: 'EUR', actorMemberId: 'stranger' }),
    ).toEqual({
      ok: false,
      error: { code: 'NOT_A_MEMBER' },
    });

    const paid = recordSettlement(t.ctx, {
      groupId,
      fromMemberId: rahul,
      toMemberId: me,
      amountPaise: 500,
      method: 'cash',
      actorMemberId: me,
    });
    if (!paid.ok) throw new Error('settlement');
    expect(isCurrencyLocked(t.ctx.db, groupId)).toBe(true);
    deleteSettlement(t.ctx, paid.value.settlementId, me);
    // Deleted rows still lock: a restore would bring back amounts in the old currency.
    expect(setGroupCurrency(t.ctx, { groupId, currency: 'EUR', actorMemberId: me })).toEqual({
      ok: false,
      error: { code: 'CURRENCY_LOCKED' },
    });
  });

  it('caps settlements by the group currency', () => {
    const jpy = setup('JPY');
    const big = {
      fromMemberId: jpy.rahul,
      toMemberId: jpy.me,
      method: 'cash' as const,
      actorMemberId: jpy.me,
    };
    expect(
      recordSettlement(t.ctx, { ...big, groupId: jpy.groupId, amountPaise: 10_000_000 }).ok,
    ).toBe(true);
    expect(
      recordSettlement(t.ctx, { ...big, groupId: jpy.groupId, amountPaise: 10_000_001 }),
    ).toEqual({
      ok: false,
      error: { code: 'INVALID_AMOUNT' },
    });
  });
});

describe('foreign bills', () => {
  const usdDinner = (g: ReturnType<typeof setup>): ExpenseDraft => ({
    groupId: g.groupId,
    description: 'Dinner at the Marina',
    amountPaise: 289920, // $30.00 at 96.64
    expenseDate: '2026-10-01',
    payers: [
      { memberId: g.me, amountPaise: 2000 },
      { memberId: g.rahul, amountPaise: 1000 },
    ],
    splitInput: { type: 'equal', memberIds: [g.me, g.rahul, g.priya] },
    foreign: { currency: 'USD', amountMinor: 3000, rate: '96.64' },
    actorMemberId: g.me,
  });

  it('stores the bill, the locked rate and group-currency lines that balance exactly', () => {
    const g = setup();
    const created = createExpense(t.ctx, usdDinner(g));
    if (!created.ok) throw new Error(JSON.stringify(created.error));

    const detail = getExpense(t.ctx.db, created.value.expenseId)!;
    expect(detail.expense).toMatchObject({
      amountPaise: 289920,
      originalCurrency: 'USD',
      originalAmountMinor: 3000,
      fxRate: '96.64',
    });
    expect(detail.shares.map((s) => s.amountPaise)).toEqual([96640, 96640, 96640]);
    expect(detail.payers.reduce((s, p) => s + p.amountPaise, 0)).toBe(289920);
    expect(detail.originalPayers?.reduce((s, p) => s + p.amountPaise, 0)).toBe(3000);
    expect(groupBillCurrencies(t.ctx.db, g.groupId)).toEqual(['USD']);

    const ledger = loadGroupLedger(t.ctx.db, g.groupId);
    const paid = ledger.expenses[0]!.payers.reduce((s, p) => s + p.amountPaise, 0);
    const owed = ledger.expenses[0]!.shares.reduce((s, p) => s + p.amountPaise, 0);
    expect(paid).toBe(owed);

    const log = t.ctx.db.select().from(activityLog).all().at(-1);
    expect((log?.after as { foreign: unknown }).foreign).toEqual({
      currency: 'USD',
      amountMinor: 3000,
      rate: '96.64',
    });
  });

  it('refuses a converted total that does not match the rate', () => {
    const g = setup();
    expect(createExpense(t.ctx, { ...usdDinner(g), amountPaise: 290000 })).toEqual({
      ok: false,
      error: { code: 'FX_TOTAL_MISMATCH', expected: 289920, actual: 290000 },
    });
  });

  it('switching back to the group currency clears the foreign columns', () => {
    const g = setup();
    const created = createExpense(t.ctx, usdDinner(g));
    if (!created.ok) throw new Error('create');
    const result = updateExpense(t.ctx, created.value.expenseId, {
      ...usdDinner(g),
      amountPaise: 300000,
      payers: [{ memberId: g.me, amountPaise: 300000 }],
      foreign: null,
    });
    expect(result.ok).toBe(true);
    const detail = getExpense(t.ctx.db, created.value.expenseId)!;
    expect(detail.expense).toMatchObject({
      originalCurrency: null,
      originalAmountMinor: null,
      fxRate: null,
    });
    expect(detail.originalPayers).toBeNull();
    expect(
      t.ctx.db
        .select()
        .from(expensePayers)
        .all()
        .every((p) => p.originalAmountMinor === null),
    ).toBe(true);
  });

  it('falls back to the bill total for a single payer without a per-line original', () => {
    const g = setup();
    const created = createExpense(t.ctx, {
      ...usdDinner(g),
      payers: [{ memberId: g.me, amountPaise: 3000 }],
    });
    if (!created.ok) throw new Error('create');
    t.ctx.db.update(expensePayers).set({ originalAmountMinor: null }).run();
    expect(getExpense(t.ctx.db, created.value.expenseId)!.originalPayers).toEqual([
      { memberId: g.me, amountPaise: 3000 },
    ]);
  });

  it('syncs: push carries the bill and the group currency; pull writes them back identically', () => {
    const g = setup('AED');
    const created = createExpense(t.ctx, {
      ...usdDinner(g),
      amountPaise: 11018, // $30.00 at 3.6725 = AED 110.175 → 110.18
      foreign: { currency: 'USD', amountMinor: 3000, rate: '3.6725' },
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));

    const collected = collectPushBatch(t.ctx)!;
    const wireGroup = collected.batch.groups[0]!;
    const wire = collected.batch.expenses[0]!;
    expect(wireGroup.currency).toBe('AED');
    expect(wire).toMatchObject({
      group_currency: 'AED',
      original_currency: 'USD',
      original_amount_minor: 3000,
      fx_rate: '3.6725',
      amount_paise: 11018,
    });
    expect(wire.payers.every((p) => typeof p.original_amount_minor === 'number')).toBe(true);
    expect(wire.shares.every((s) => !('original_amount_minor' in s))).toBe(true);

    // Lost push response: the server copy (no group_currency, version set) is the same content.
    const serverRow: Incoming<WireExpense> = { ...wire, version: 1 };
    delete (serverRow as Partial<typeof serverRow> & { base_version?: number }).base_version;
    delete serverRow.group_currency;
    expect(sameContent(wire, serverRow)).toBe(true);

    applyPushResult(t.ctx, collected, {
      applied: [
        ...collected.batch.groups.map((r) => ({ table: 'groups' as const, id: r.id, version: 1 })),
        ...collected.batch.members.map((r) => ({
          table: 'members' as const,
          id: r.id,
          version: 1,
        })),
        { table: 'expenses' as const, id: wire.id, version: 1 },
      ],
      conflicts: [],
      rejected: [],
    });

    // Another phone edits the rate; this phone pulls it.
    const edited: Incoming<WireExpense> = {
      ...serverRow,
      fx_rate: '3.67',
      amount_paise: 11010,
      updated_at: serverRow.updated_at + 1,
      version: 2,
    };
    const page: PullResult = {
      cursor: '5',
      group_ids: [g.groupId],
      groups: [],
      members: [],
      expenses: [edited],
      settlements: [],
      activity: [],
    };
    applyPull(t.ctx, page);
    const row = t.ctx.db.select().from(expenses).where(eq(expenses.id, wire.id)).get()!;
    expect(row).toMatchObject({
      fxRate: '3.67',
      amountPaise: 11010,
      originalCurrency: 'USD',
      dirty: false,
    });
    const payers = t.ctx.db
      .select()
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, wire.id))
      .all();
    expect(payers.map((p) => p.originalAmountMinor).sort()).toEqual([1000, 2000]);
    const detail = getExpense(t.ctx.db, wire.id)!;
    expect(sameContent(expenseToWire(detail.expense, payers, detail.shares), edited)).toBe(true);
  });

  it('pull from a server without multi-currency keeps INR and no foreign data', () => {
    const g = setup();
    const page: PullResult = {
      cursor: '1',
      group_ids: [g.groupId],
      groups: [
        {
          id: g.groupId,
          name: 'Dubai',
          simplify_debts: true,
          created_at: 1,
          updated_at: 2,
          deleted_at: null,
          version: 1,
        },
      ],
      members: [],
      expenses: [],
      settlements: [],
      activity: [],
    };
    // Local copy is dirty (never pushed), so mark it clean first to accept the server row.
    t.ctx.db.update(groups).set({ dirty: false }).run();
    applyPull(t.ctx, page);
    expect(groupCurrency(t.ctx.db, g.groupId)).toBe('INR');
  });
});
