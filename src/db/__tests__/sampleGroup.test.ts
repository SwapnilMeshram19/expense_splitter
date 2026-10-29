import { collectPushBatch } from '@/legacy/sync/engine';
import { countPendingChanges } from '@/legacy/sync/issueActions';

import { createExpense } from '../repositories/expenses';
import { activeGroupsQuery, createGroup } from '../repositories/groups';
import { getOrCreateDeviceUserId, setSetting } from '../repositories/profile';
import {
  removeLegacySampleGroups,
  removeSampleGroup,
  SAMPLE_GROUP_IDS_KEY,
  sampleGroupIds,
} from '../repositories/sampleGroup';
import { expenses, groups, members, settings } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;
let me: string;

beforeEach(() => {
  t = createTestContext();
  me = getOrCreateDeviceUserId(t.ctx);
});
afterEach(() => t.close());

function makeGroup(name: string) {
  const r = createGroup(t.ctx, { name, selfName: 'Asha', otherMemberNames: ['Ravi'], deviceUserId: me });
  if (!r.ok) throw new Error('group');
  return r.value;
}

/** What builds up to 1.0.0 left behind: a group listed under the local example ids, with an expense. */
function legacySample() {
  const g = makeGroup('Old example');
  setSetting(t.ctx, SAMPLE_GROUP_IDS_KEY, JSON.stringify([g.groupId]));
  createExpense(t.ctx, {
    groupId: g.groupId,
    description: 'Lunch',
    amountPaise: 60000,
    expenseDate: '2026-10-18',
    payers: [{ memberId: g.selfMemberId, amountPaise: 60000 }],
    splitInput: { type: 'equal', memberIds: [g.selfMemberId] },
    actorMemberId: g.selfMemberId,
  });
  return g.groupId;
}

describe('removeLegacySampleGroups', () => {
  it('deletes a leftover example and everything in it', () => {
    legacySample();
    expect(removeLegacySampleGroups(t.ctx)).toEqual([]);
    expect(t.ctx.db.select().from(groups).all()).toHaveLength(0);
    expect(t.ctx.db.select().from(members).all()).toHaveLength(0);
    expect(t.ctx.db.select().from(expenses).all()).toHaveLength(0);
    expect(sampleGroupIds(t.ctx.db).size).toBe(0);
  });

  it('leaves real groups alone', () => {
    legacySample();
    const real = makeGroup('Flat');
    removeLegacySampleGroups(t.ctx);
    expect(activeGroupsQuery(t.ctx.db).all().map((g) => g.id)).toEqual([real.groupId]);
  });

  it('is a no-op without examples, and safe to run on every launch', () => {
    makeGroup('Flat');
    expect(removeLegacySampleGroups(t.ctx)).toEqual([]);
    expect(removeLegacySampleGroups(t.ctx)).toEqual([]);
    expect(activeGroupsQuery(t.ctx.db).all()).toHaveLength(1);
  });

  it('survives a corrupt id list', () => {
    makeGroup('Flat');
    setSetting(t.ctx, SAMPLE_GROUP_IDS_KEY, '{not json');
    expect(removeLegacySampleGroups(t.ctx)).toEqual([]);
    expect(activeGroupsQuery(t.ctx.db).all()).toHaveLength(1);
  });
});

describe('removeSampleGroup', () => {
  it('refuses real groups', () => {
    const real = makeGroup('Flat');
    expect(removeSampleGroup(t.ctx, real.groupId)).toEqual({ ok: false, error: { code: 'NOT_SAMPLE' } });
  });
});

describe('a leftover example, if cleanup never ran', () => {
  it('never syncs', () => {
    const sampleId = legacySample();
    const real = makeGroup('Flat');
    const batch = collectPushBatch(t.ctx)!.batch;
    expect(batch.groups.map((g) => g.id)).toEqual([real.groupId]);
    const rowGroupIds = [...batch.members, ...batch.expenses, ...batch.activity].map(
      (r) => (r as { group_id: string }).group_id,
    );
    expect(rowGroupIds).not.toContain(sampleId);
    expect(countPendingChanges(t.ctx)).toBe(batch.groups.length + batch.members.length + batch.activity.length);
  });

  it('keeps the id list in the local settings table only', () => {
    legacySample();
    expect(t.ctx.db.select().from(settings).all().map((s) => s.key)).toContain(SAMPLE_GROUP_IDS_KEY);
  });
});
