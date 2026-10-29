import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { getReceiptFile, markReceiptDiscarded, recordDownloadedReceipt, registerOwnReceipt } from '@/db/repositories/receipts';

import { runReceiptQueue, type ReceiptQueueDeps, type ServerExpenseRef, type UploadOutcome } from '../receiptQueue';
import { fitWithin, formatBytes } from '../sizing';

const R1 = '0192f0c4-7b1a-7c3e-8a10-000000000001';
const R2 = '0192f0c4-7b1a-7c3e-8a10-000000000002';
const E1 = '0192f0c4-7b1a-7c3e-8a10-0000000000e1';
const G1 = '0192f0c4-7b1a-7c3e-8a10-0000000000a1';

let t: TestContext;
/** The expense as the data store shows it (null = not in any of my groups). */
let expense: ServerExpenseRef | null;
let queued: boolean;
beforeEach(() => {
  t = createTestContext();
  expense = null;
  queued = false;
});
afterEach(() => t.close());

function fakeStorage(uploadResult: UploadOutcome = 'ok') {
  const local = new Set<string>();
  const server = new Set<string>();
  const calls: string[] = [];
  const deps: ReceiptQueueDeps = {
    expense: (id) => (id === E1 ? expense : null),
    referenced: (ids) => new Set(ids.filter((id) => expense?.receiptId === id)),
    isQueued: () => queued,
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

/** A photo taken here for E1, saved but not yet on the server. */
function takePhoto(receiptId = R1) {
  registerOwnReceipt(t.ctx.db, { receiptId, expenseId: E1, groupId: G1, bytes: 1000 }, t.ctx.now());
}

describe('receipt queue', () => {
  it('uploads only after the expense reached the server', async () => {
    takePhoto();
    const s = fakeStorage();
    s.local.add(R1);

    queued = true; // waiting in the offline queue
    expect(await runReceiptQueue(t.ctx, s.deps)).toEqual({ uploaded: 0, removed: 0, failed: 0 });
    expense = { receiptId: R1, pending: true }; // being sent
    expect(await runReceiptQueue(t.ctx, s.deps)).toEqual({ uploaded: 0, removed: 0, failed: 0 });
    expect(s.calls).toEqual([]);

    expense = { receiptId: R1, pending: false };
    expect((await runReceiptQueue(t.ctx, s.deps)).uploaded).toBe(1);
    expect(getReceiptFile(t.ctx.db, R1)!.state).toBe('synced');
    expect(s.local.has(R1)).toBe(true); // keeps its own copy
  });

  it('backs off after a failure', async () => {
    takePhoto();
    expense = { receiptId: R1, pending: false };
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
    takePhoto(R1);
    expense = { receiptId: R1, pending: false };
    const s = fakeStorage();
    s.local.add(R1);
    await runReceiptQueue(t.ctx, s.deps); // R1 uploaded

    // Edited with a new photo: the edit is on its way.
    markReceiptDiscarded(t.ctx.db, { receiptId: R1, expenseId: E1, groupId: G1 }, t.ctx.now());
    takePhoto(R2);
    s.local.add(R2);
    expense = { receiptId: R2, pending: true };
    await runReceiptQueue(t.ctx, s.deps);
    expect(s.calls).toEqual([`upload ${R1}`]); // no upload of R2, no delete of R1 yet

    expense = { receiptId: R2, pending: false };
    const report = await runReceiptQueue(t.ctx, s.deps);
    expect(report).toEqual({ uploaded: 1, removed: 1, failed: 0 });
    expect(getReceiptFile(t.ctx.db, R1)).toBeNull();
    expect(s.local.has(R1)).toBe(false);
  });

  it('keeps a discarded photo that an expense points at again', async () => {
    takePhoto(R1);
    const s = fakeStorage();
    s.local.add(R1);
    markReceiptDiscarded(t.ctx.db, { receiptId: R1, expenseId: E1, groupId: G1 }, t.ctx.now());
    // Someone else's edit put R1 back.
    expense = { receiptId: R1, pending: false };
    await runReceiptQueue(t.ctx, s.deps);
    expect(s.calls.some((c) => c.startsWith('remove'))).toBe(false);
    expect(getReceiptFile(t.ctx.db, R1)!.state).toBe('synced'); // re-uploaded (already there is fine)
  });

  it('frees downloaded photos nothing points at any more', async () => {
    const s = fakeStorage();
    recordDownloadedReceipt(t.ctx.db, { receiptId: R2, expenseId: E1, groupId: G1 }, 10, 1);
    s.local.add(R2);
    expense = { receiptId: null, pending: false };
    await runReceiptQueue(t.ctx, s.deps);
    expect(getReceiptFile(t.ctx.db, R2)).toBeNull();
    expect(s.local.has(R2)).toBe(false);
  });

  it('drops an upload whose file or expense is gone', async () => {
    takePhoto();
    expense = { receiptId: R1, pending: false };
    const s = fakeStorage(); // R1 not in local
    await runReceiptQueue(t.ctx, s.deps);
    expect(getReceiptFile(t.ctx.db, R1)).toBeNull();

    takePhoto(R2);
    s.local.add(R2);
    expense = null; // deleted, or the group was left
    await runReceiptQueue(t.ctx, s.deps);
    expect(getReceiptFile(t.ctx.db, R2)).toBeNull();
    expect(s.local.has(R2)).toBe(false);
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
