import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense, updateExpense, type ExpenseDraft } from '@/db/repositories/expenses';
import { createGroup } from '@/db/repositories/groups';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { getReceiptFile, recordDownloadedReceipt } from '@/db/repositories/receipts';
import { expenses } from '@/db/schema';
import { eq } from 'drizzle-orm';

import { runReceiptQueue, type ReceiptQueueDeps, type UploadOutcome } from '../receiptQueue';
import { fitWithin, formatBytes } from '../sizing';

const R1 = '0192f0c4-7b1a-7c3e-8a10-000000000001';
const R2 = '0192f0c4-7b1a-7c3e-8a10-000000000002';

let t: TestContext;
beforeEach(() => {
  t = createTestContext();
});
afterEach(() => t.close());

function fakeStorage(uploadResult: UploadOutcome = 'ok') {
  const local = new Set<string>();
  const server = new Set<string>();
  const calls: string[] = [];
  const deps: ReceiptQueueDeps = {
    upload: async (path, id) => {
      calls.push(`upload ${id}`);
      if (uploadResult === 'ok') server.add(path);
      return local.has(id) ? uploadResult : 'missingFile';
    },
    remove: async (path) => {
      calls.push(`remove ${path.split('/')[2]}`);
      server.delete(path);
      return 'ok';
    },
    hasLocal: (id) => local.has(id),
    deleteLocal: (id) => {
      local.delete(id);
    },
  };
  return { deps, local, server, calls };
}

function expenseWithReceipt() {
  const created = createGroup(t.ctx, {
    name: 'Goa',
    selfName: 'Asha',
    otherMemberNames: [],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error('group');
  const { groupId, selfMemberId: me } = created.value;
  const draft: ExpenseDraft = {
    groupId,
    description: 'Lunch',
    amountPaise: 50000,
    expenseDate: '2026-10-01',
    payers: [{ memberId: me, amountPaise: 50000 }],
    splitInput: { type: 'equal', memberIds: [me] },
    actorMemberId: me,
    receiptId: R1,
    newReceipt: { receiptId: R1, bytes: 1000 },
  };
  const result = createExpense(t.ctx, draft);
  if (!result.ok) throw new Error('expense');
  return { draft, expenseId: result.value.expenseId };
}

const markPushed = (expenseId: string) =>
  t.ctx.db.update(expenses).set({ dirty: false, version: 1 }).where(eq(expenses.id, expenseId)).run();

describe('receipt queue', () => {
  it('uploads only after the expense reached the server', async () => {
    const { expenseId } = expenseWithReceipt();
    const s = fakeStorage();
    s.local.add(R1);

    expect(await runReceiptQueue(t.ctx, s.deps)).toEqual({ uploaded: 0, removed: 0, failed: 0 });
    expect(s.calls).toEqual([]);

    markPushed(expenseId);
    expect((await runReceiptQueue(t.ctx, s.deps)).uploaded).toBe(1);
    expect(getReceiptFile(t.ctx.db, R1)!.state).toBe('synced');
    expect(s.local.has(R1)).toBe(true); // keeps its own copy
  });

  it('backs off after a failure', async () => {
    const { expenseId } = expenseWithReceipt();
    markPushed(expenseId);
    const s = fakeStorage({ error: 'NETWORK' });
    s.local.add(R1);

    expect((await runReceiptQueue(t.ctx, s.deps)).failed).toBe(1);
    expect(getReceiptFile(t.ctx.db, R1)).toMatchObject({ state: 'upload', attempts: 1, lastError: 'NETWORK' });
    await runReceiptQueue(t.ctx, s.deps);
    expect(s.calls).toHaveLength(1); // too soon to retry
    t.advance(61_000);
    await runReceiptQueue(t.ctx, s.deps);
    expect(s.calls).toHaveLength(2);
  });

  it('deletes a replaced photo once the change is on the server, never before', async () => {
    const { draft, expenseId } = expenseWithReceipt();
    markPushed(expenseId);
    const s = fakeStorage();
    s.local.add(R1);
    await runReceiptQueue(t.ctx, s.deps); // R1 uploaded

    expect(updateExpense(t.ctx, expenseId, { ...draft, receiptId: R2, newReceipt: { receiptId: R2, bytes: 1 } }).ok).toBe(true);
    s.local.add(R2);
    await runReceiptQueue(t.ctx, s.deps);
    expect(s.calls).toEqual([`upload ${R1}`]); // expense not pushed yet: no upload of R2, no delete of R1

    markPushed(expenseId);
    const report = await runReceiptQueue(t.ctx, s.deps);
    expect(report).toEqual({ uploaded: 1, removed: 1, failed: 0 });
    expect(getReceiptFile(t.ctx.db, R1)).toBeNull();
    expect(s.local.has(R1)).toBe(false);
  });

  it('keeps a discarded photo that an expense points at again', async () => {
    const { draft, expenseId } = expenseWithReceipt();
    const s = fakeStorage();
    s.local.add(R1);
    updateExpense(t.ctx, expenseId, { ...draft, receiptId: null, newReceipt: null });
    expect(getReceiptFile(t.ctx.db, R1)!.state).toBe('discard');

    // Conflict review restored the server version, which still has R1.
    t.ctx.db.update(expenses).set({ receiptId: R1, dirty: false, version: 2 }).where(eq(expenses.id, expenseId)).run();
    await runReceiptQueue(t.ctx, s.deps);
    expect(s.calls.some((c) => c.startsWith('remove'))).toBe(false);
    expect(getReceiptFile(t.ctx.db, R1)!.state).toBe('synced'); // re-uploaded (already there is fine)
  });

  it('frees downloaded photos nothing points at any more', async () => {
    const { expenseId } = expenseWithReceipt();
    const s = fakeStorage();
    const groupId = t.ctx.db.select().from(expenses).get()!.groupId;
    recordDownloadedReceipt(t.ctx.db, { receiptId: R2, expenseId, groupId }, 10, 1);
    s.local.add(R2);
    await runReceiptQueue(t.ctx, s.deps);
    expect(getReceiptFile(t.ctx.db, R2)).toBeNull();
    expect(s.local.has(R2)).toBe(false);
  });

  it('drops an upload whose file is gone', async () => {
    const { expenseId } = expenseWithReceipt();
    markPushed(expenseId);
    const s = fakeStorage(); // R1 not in local
    await runReceiptQueue(t.ctx, s.deps);
    expect(getReceiptFile(t.ctx.db, R1)).toBeNull();
  });
});

describe('photo sizing', () => {
  it('fits the long edge without enlarging', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600 });
    expect(fitWithin(1080, 4000, 1600)).toEqual({ height: 1600 });
    expect(fitWithin(1200, 900, 1600)).toBeNull();
    expect(fitWithin(0, 900, 1600)).toBeNull();
  });

  it('formats sizes', () => {
    expect(formatBytes(214_000)).toBe('209 KB');
    expect(formatBytes(300)).toBe('1 KB');
    expect(formatBytes(1_300_000)).toBe('1.2 MB');
  });
});
