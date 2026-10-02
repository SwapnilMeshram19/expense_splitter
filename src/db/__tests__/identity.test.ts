import { eq } from 'drizzle-orm';

import { createGroup, deleteGroup } from '../repositories/groups';
import { getLinkedAccountId, linkAccount } from '../repositories/identity';
import { findSelfMemberId } from '../repositories/members';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import { members } from '../schema';
import { createTestContext, type TestContext } from './testDb';

const ACCOUNT = '0192f0c4-7c2a-7d3e-8f10-1234567890ab';
const OTHER = '0192f0c4-7c2a-7d3e-8f10-ba0987654321';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function makeGroup(name: string, others: string[] = ['Rahul']) {
  const created = createGroup(t.ctx, {
    name,
    selfName: 'Asha',
    otherMemberNames: others,
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  return created.value;
}

const memberRow = (id: string) => t.ctx.db.select().from(members).where(eq(members.id, id)).get()!;
const markAllClean = () => t.ctx.db.update(members).set({ dirty: false }).run();

describe('linkAccount', () => {
  it('relinks the self member in every group to the account', () => {
    const goa = makeGroup('Goa');
    const flat = makeGroup('Flat');
    const deviceId = getOrCreateDeviceUserId(t.ctx);
    markAllClean();
    t.advance(1000);

    const result = linkAccount(t.ctx, ACCOUNT);

    expect(result).toEqual({ ok: true, value: { relinkedMembers: 2, detachedGroupIds: [] } });
    for (const g of [goa, flat]) {
      const self = memberRow(g.selfMemberId);
      expect(self.userId).toBe(ACCOUNT);
      expect(self.dirty).toBe(true);
      expect(self.updatedAt).toBe(t.ctx.now());
      expect(findSelfMemberId(t.ctx.db, g.groupId, ACCOUNT)).toBe(g.selfMemberId);
    }
    expect(getOrCreateDeviceUserId(t.ctx)).toBe(ACCOUNT);
    expect(getLinkedAccountId(t.ctx)).toBe(ACCOUNT);
    expect(t.ctx.db.select().from(members).where(eq(members.userId, deviceId)).all()).toHaveLength(0);
  });

  it('leaves placeholders and other members untouched', () => {
    const goa = makeGroup('Goa', ['Rahul', 'Mom']);
    markAllClean();

    linkAccount(t.ctx, ACCOUNT);

    const others = t.ctx.db
      .select()
      .from(members)
      .where(eq(members.groupId, goa.groupId))
      .all()
      .filter((m) => m.id !== goa.selfMemberId);
    expect(others).toHaveLength(2);
    for (const m of others) {
      expect(m.userId).toBeNull();
      expect(m.dirty).toBe(false);
    }
  });

  it('is idempotent for the same account, case-insensitively', () => {
    makeGroup('Goa');
    expect(linkAccount(t.ctx, ACCOUNT.toUpperCase()).ok).toBe(true);
    expect(getLinkedAccountId(t.ctx)).toBe(ACCOUNT);

    expect(linkAccount(t.ctx, ACCOUNT)).toEqual({
      ok: true,
      value: { relinkedMembers: 0, detachedGroupIds: [] },
    });
  });

  it('refuses a different account and changes nothing', () => {
    const goa = makeGroup('Goa');
    linkAccount(t.ctx, ACCOUNT);

    expect(linkAccount(t.ctx, OTHER)).toEqual({ ok: false, error: { code: 'OTHER_ACCOUNT_LINKED' } });
    expect(memberRow(goa.selfMemberId).userId).toBe(ACCOUNT);
    expect(getOrCreateDeviceUserId(t.ctx)).toBe(ACCOUNT);
    expect(getLinkedAccountId(t.ctx)).toBe(ACCOUNT);
  });

  it('rejects ids that are not UUIDs without changing anything', () => {
    const goa = makeGroup('Goa');
    const deviceId = getOrCreateDeviceUserId(t.ctx);

    expect(linkAccount(t.ctx, 'not-a-uuid')).toEqual({ ok: false, error: { code: 'INVALID_USER_ID' } });
    expect(memberRow(goa.selfMemberId).userId).toBe(deviceId);
    expect(getLinkedAccountId(t.ctx)).toBeNull();
  });

  it('links a fresh install; groups created afterwards use the account id', () => {
    expect(linkAccount(t.ctx, ACCOUNT)).toEqual({
      ok: true,
      value: { relinkedMembers: 0, detachedGroupIds: [] },
    });

    const goa = makeGroup('Goa');
    expect(memberRow(goa.selfMemberId).userId).toBe(ACCOUNT);
  });

  it('relinks self members of deleted groups so tombstones sync with the right owner', () => {
    const old = makeGroup('Old trip');
    const deleted = deleteGroup(t.ctx, { groupId: old.groupId, actorMemberId: old.selfMemberId });
    expect(deleted.ok).toBe(true);

    linkAccount(t.ctx, ACCOUNT);

    expect(memberRow(old.selfMemberId).userId).toBe(ACCOUNT);
  });

  it('detaches the stale device row when the group already has the account', () => {
    const goa = makeGroup('Goa');
    // Simulates a row synced from another phone where this account is already a member.
    t.ctx.db
      .insert(members)
      .values({
        id: 'synced-me',
        groupId: goa.groupId,
        displayName: 'Asha (other phone)',
        userId: ACCOUNT,
        createdAt: t.ctx.now(),
        updatedAt: t.ctx.now(),
        dirty: false,
      })
      .run();
    markAllClean();

    const result = linkAccount(t.ctx, ACCOUNT);

    expect(result).toEqual({ ok: true, value: { relinkedMembers: 0, detachedGroupIds: [goa.groupId] } });
    const stale = memberRow(goa.selfMemberId);
    expect(stale.userId).toBeNull();
    expect(stale.dirty).toBe(true);
    expect(findSelfMemberId(t.ctx.db, goa.groupId, ACCOUNT)).toBe('synced-me');
  });
});