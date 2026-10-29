import { eq } from 'drizzle-orm';

import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createGroup } from '@/db/repositories/groups';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { groups } from '@/db/schema';

import { getSyncCursor } from '../engine';
import { getRefetchGroupIds } from '../issueActions';
import { runSync, type SyncTransport } from '../runSync';
import { groupToWire, type PullResult, type PushBatch, type PushResult, type RowOutcome } from '../wire';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

/** What the server answers when every row applies: version = base_version + 1. */
function ackAll(batch: PushBatch): PushResult {
  const applied: RowOutcome[] = [
    ...batch.groups.map((r) => ({ table: 'groups' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.members.map((r) => ({ table: 'members' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.expenses.map((r) => ({ table: 'expenses' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.settlements.map((r) => ({ table: 'settlements' as const, id: r.id, version: r.base_version + 1 })),
    ...batch.activity.map((r) => ({ table: 'activity' as const, id: r.id, version: null })),
  ];
  return { applied, conflicts: [], rejected: [] };
}

const pull = (overrides: Partial<PullResult> = {}): PullResult => ({
  cursor: '100',
  group_ids: [],
  groups: [],
  members: [],
  expenses: [],
  settlements: [],
  activity: [],
  ...overrides,
});

/** A transport that answers pulls from a script (an Error = network failure), recording calls. */
function scripted(pages: (PullResult | Error)[]) {
  const calls: [string | null, string[]][] = [];
  const transport: SyncTransport = {
    push: async (batch) => ackAll(batch),
    pull: async (cursor, full) => {
      calls.push([cursor, full]);
      const next = pages.shift();
      if (!next) throw new Error('unexpected pull');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { transport, calls };
}

describe('paged pull', () => {
  it('saves the cursor after every incremental page and resumes there after a failure', async () => {
    const first = scripted([
      pull({ cursor: 'p2:0:200:1:150:a', more: true }),
      pull({ cursor: 'p2:0:200:2:160:b', more: true }),
      new Error('offline'),
    ]);
    await expect(runSync(t.ctx, first.transport)).rejects.toThrow('offline');
    expect(first.calls.map(([cursor]) => cursor)).toEqual([null, 'p2:0:200:1:150:a', 'p2:0:200:2:160:b']);
    expect(getSyncCursor(t.ctx)).toBe('p2:0:200:2:160:b');

    const second = scripted([pull({ cursor: '200' })]);
    await runSync(t.ctx, second.transport);
    expect(second.calls).toEqual([['p2:0:200:2:160:b', []]]);
    expect(getSyncCursor(t.ctx)).toBe('200');
  });

  it('restarts an interrupted full fetch instead of resuming it half-way', async () => {
    const first = scripted([
      pull({ cursor: '100', group_ids: ['g-remote'] }),
      pull({ cursor: 'p2:100:101:1:100:x', more: true, group_ids: ['g-remote'] }),
      new Error('offline'),
    ]);
    await expect(runSync(t.ctx, first.transport)).rejects.toThrow('offline');
    expect(getSyncCursor(t.ctx)).toBe('100'); // the mid-pass full-fetch cursor was not saved
    expect(getRefetchGroupIds(t.ctx)).toEqual(['g-remote']);

    const second = scripted([
      pull({ cursor: '100', group_ids: ['g-remote'] }),
      pull({ cursor: '102', group_ids: ['g-remote'] }),
    ]);
    await runSync(t.ctx, second.transport);
    expect(second.calls).toEqual([
      ['100', []],
      ['100', ['g-remote']],
    ]);
    expect(getSyncCursor(t.ctx)).toBe('102');
    expect(getRefetchGroupIds(t.ctx)).toEqual([]);
  });

  it('full-fetches a newly visible group even when its row arrived in the incremental pull', async () => {
    const created = createGroup(t.ctx, {
      name: 'Mine',
      selfName: 'Asha',
      otherMemberNames: [],
      deviceUserId: getOrCreateDeviceUserId(t.ctx),
    });
    if (!created.ok) throw new Error('group failed');
    const localId = created.value.groupId;
    const localRow = t.ctx.db.select().from(groups).where(eq(groups.id, localId)).get()!;
    const remoteRow = { ...groupToWire(localRow), id: 'g-remote', name: 'Flat', version: 1 };

    const { transport, calls } = scripted([
      pull({ cursor: '100', group_ids: [localId, 'g-remote'], groups: [remoteRow] }),
      pull({ cursor: '101', group_ids: [localId, 'g-remote'] }),
    ]);
    await runSync(t.ctx, transport);

    expect(calls[1]).toEqual(['100', ['g-remote']]);
    expect(getSyncCursor(t.ctx)).toBe('101');
  });
});