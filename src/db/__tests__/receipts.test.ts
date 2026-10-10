import { applyPull } from '@/sync/engine';
import { expenseToWire, type Incoming, type PullResult, type WireExpense } from '@/sync/wire';

import { createExpense, getExpense, updateExpense, type ExpenseDraft } from '../repositories/expenses';
import { createGroup } from '../repositories/groups';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import {
  getReceiptFile,
  markReceiptDiscarded,
  pendingReceiptUploads,
  recordDownloadedReceipt,
  referencedReceiptIds,
} from '../repositories/receipts';
import { activityLog, expenses } from '../schema';
import { createTestContext, type TestContext } from './testDb';

const R1 = '0192f0c4-7b1a-7c3e-8a10-000000000001';
const R2 = '0192f0c4-7b1a-7c3e-8a10-000000000002';

let t: TestContext;
beforeEach(() => {
  t = createTestContext();
});
afterEach(() => t.close());

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Goa',
    selfName: 'Asha',
    otherMemberNames: [],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error('createGroup failed');
  return created.value;
}

const draft = (groupId: string, me: string, patch: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  groupId,
  description: 'Lunch',
  amountPaise: 50000,
  expenseDate: '2026-10-01',
  payers: [{ memberId: me, amountPaise: 50000 }],
  splitInput: { type: 'equal', memberIds: [me] },
  actorMemberId: me,
  ...patch,
});

describe('notes and receipts on expenses', () => {
  it('saves a normalised note and a new receipt, queued for upload', () => {
    const { groupId, selfMemberId: me } = setup();
    const created = createExpense(
      t.ctx,
      draft(groupId, me, { note: '  Table 4\r\nincl. tip ', receiptId: R1, newReceipt: { receiptId: R1, bytes: 210_000 } }),
    );
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const { expense } = getExpense(t.ctx.db, created.value.expenseId)!;
    expect(expense.note).toBe('Table 4\nincl. tip');
    expect(expense.receiptId).toBe(R1);
    expect(getReceiptFile(t.ctx.db, R1)).toMatchObject({ state: 'upload', bytes: 210_000, groupId });
    expect(pendingReceiptUploads(t.ctx.db)).toBe(1);

    const log = t.ctx.db.select().from(activityLog).all().find((l) => l.entityType === 'expense')!;
    expect(log.after).toMatchObject({ note: 'Table 4\nincl. tip', receiptId: R1 });
  });

  it('keeps note and receipt when an edit leaves them out, and discards a replaced photo', () => {
    const { groupId, selfMemberId: me } = setup();
    const created = createExpense(t.ctx, draft(groupId, me, { note: 'n', receiptId: R1, newReceipt: { receiptId: R1, bytes: 1 } }));
    if (!created.ok) throw new Error('create failed');
    const id = created.value.expenseId;

    expect(updateExpense(t.ctx, id, draft(groupId, me, { description: 'Lunch 2' })).ok).toBe(true);
    expect(getExpense(t.ctx.db, id)!.expense).toMatchObject({ note: 'n', receiptId: R1 });

    expect(updateExpense(t.ctx, id, draft(groupId, me, { receiptId: R2, newReceipt: { receiptId: R2, bytes: 2 } })).ok).toBe(true);
    expect(getReceiptFile(t.ctx.db, R1)!.state).toBe('discard');
    expect(getReceiptFile(t.ctx.db, R2)!.state).toBe('upload');

    expect(updateExpense(t.ctx, id, draft(groupId, me, { note: null, receiptId: null })).ok).toBe(true);
    expect(getExpense(t.ctx.db, id)!.expense).toMatchObject({ note: null, receiptId: null });
    expect(getReceiptFile(t.ctx.db, R2)!.state).toBe('discard');
  });

  it('refuses long notes, malformed receipt ids and mismatched new photos', () => {
    const { groupId, selfMemberId: me } = setup();
    expect(createExpense(t.ctx, draft(groupId, me, { note: 'x'.repeat(501) }))).toEqual({
      ok: false,
      error: { code: 'NOTE_TOO_LONG' },
    });
    expect(createExpense(t.ctx, draft(groupId, me, { receiptId: '../x' }))).toEqual({
      ok: false,
      error: { code: 'INVALID_RECEIPT' },
    });
    expect(
      createExpense(t.ctx, draft(groupId, me, { receiptId: R1, newReceipt: { receiptId: R2, bytes: 1 } })),
    ).toEqual({ ok: false, error: { code: 'INVALID_RECEIPT' } });
  });

  it('sends both on the wire and takes them from a pull', () => {
    const { groupId, selfMemberId: me } = setup();
    const created = createExpense(t.ctx, draft(groupId, me, { note: 'n', receiptId: R1 }));
    if (!created.ok) throw new Error('create failed');
    const detail = getExpense(t.ctx.db, created.value.expenseId)!;
    const wire = expenseToWire(detail.expense, detail.payers, detail.shares);
    expect(wire).toMatchObject({ note: 'n', receipt_id: R1 });

    const incoming: Incoming<WireExpense> = { ...wire, note: 'from Rahul', receipt_id: R2, version: 3 };
    const pull: PullResult = {
      cursor: '1',
      more: false,
      group_ids: [groupId],
      groups: [],
      members: [],
      expenses: [incoming],
      settlements: [],
      activity: [],
    };
    // The local row is unsynced (dirty), so mark it clean first to accept the server copy.
    t.ctx.db.update(expenses).set({ dirty: false, version: 2 }).run();
    applyPull(t.ctx, pull, { saveCursor: true });
    expect(getExpense(t.ctx.db, created.value.expenseId)!.expense).toMatchObject({
      note: 'from Rahul',
      receiptId: R2,
    });
    expect(referencedReceiptIds(t.ctx.db)).toEqual(new Set([R2]));
  });

  it('never lets a download downgrade a pending upload', () => {
    const { groupId } = setup();
    markReceiptDiscarded(t.ctx.db, { receiptId: R1, expenseId: 'e', groupId }, 1);
    recordDownloadedReceipt(t.ctx.db, { receiptId: R1, expenseId: 'e', groupId }, 5, 2);
    expect(getReceiptFile(t.ctx.db, R1)!.state).toBe('discard');
  });
});
