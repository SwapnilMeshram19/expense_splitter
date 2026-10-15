import { and, eq } from 'drizzle-orm';

import type { PayMethod } from '@/domain/payMethods';

import { createGroup } from '../repositories/groups';
import {
  applyMyPayDetailsToGroup,
  getMyPayDetails,
  myGroupCount,
  saveMyPayDetails,
  setMemberPayDetails,
  setMemberPayMethods,
} from '../repositories/memberPayDetails';
import { activeMembersQuery } from '../repositories/members';
import { setMemberUpiVpa } from '../repositories/memberUpi';
import { getOrCreateDeviceUserId } from '../repositories/profile';
import { activityLog, members } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

const paypal: PayMethod = { kind: 'link', url: 'https://paypal.me/asha' };
const iban: PayMethod = { kind: 'iban', name: 'Asha M', iban: 'DE89370400440532013000' };

function group(name: string) {
  const created = createGroup(t.ctx, {
    name,
    selfName: 'Asha',
    otherMemberNames: ['Rahul'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const { groupId, selfMemberId: me } = created.value;
  const rahul = activeMembersQuery(t.ctx.db, groupId).all().find((m) => m.displayName === 'Rahul')!.id;
  return { groupId, me, rahul };
}

const row = (id: string) => t.ctx.db.select().from(members).where(eq(members.id, id)).get()!;
const logOf = (id: string) =>
  t.ctx.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, 'member'), eq(activityLog.entityId, id)))
    .all();

describe('setMemberPayMethods', () => {
  it('stores the list, marks the row dirty and logs only the kinds', () => {
    const g = group('Trip');
    expect(setMemberPayMethods(t.ctx, { memberId: g.me, methods: [paypal, iban], actorMemberId: g.me })).toEqual({
      ok: true,
      value: [paypal, iban],
    });
    expect(JSON.parse(row(g.me).payMethods!)).toEqual([paypal, iban]);
    expect(row(g.me).dirty).toBe(true);
    const log = logOf(g.me).at(-1)!;
    expect(log.before).toEqual({ payMethods: [] });
    expect(log.after).toEqual({ payMethods: ['link', 'iban'] });
    expect(JSON.stringify(log)).not.toContain('DE89');
  });

  it('removes duplicates, clears with an empty list and skips no-op saves', () => {
    const g = group('Trip');
    setMemberPayMethods(t.ctx, {
      memberId: g.me,
      methods: [paypal, { kind: 'link', url: 'https://www.paypal.me/Asha/' }],
      actorMemberId: g.me,
    });
    expect(JSON.parse(row(g.me).payMethods!)).toEqual([paypal]);
    const logs = logOf(g.me).length;
    setMemberPayMethods(t.ctx, { memberId: g.me, methods: [paypal], actorMemberId: g.me });
    expect(logOf(g.me)).toHaveLength(logs);
    setMemberPayMethods(t.ctx, { memberId: g.me, methods: [], actorMemberId: g.me });
    expect(row(g.me).payMethods).toBeNull();
  });

  it('follows the UPI ownership rule: placeholders yes, claimed members no', () => {
    const g = group('Trip');
    expect(setMemberPayMethods(t.ctx, { memberId: g.rahul, methods: [paypal], actorMemberId: g.me }).ok).toBe(true);
    t.ctx.db.update(members).set({ userId: 'someone-else' }).where(eq(members.id, g.rahul)).run();
    expect(setMemberPayMethods(t.ctx, { memberId: g.rahul, methods: [], actorMemberId: g.me })).toEqual({
      ok: false,
      error: { code: 'NOT_ALLOWED' },
    });
  });
});

describe('setMemberPayDetails', () => {
  it('saves nothing when the UPI ID is invalid', () => {
    const g = group('Trip');
    const result = setMemberPayDetails(t.ctx, { memberId: g.me, vpaInput: 'not a vpa', methods: [paypal], actorMemberId: g.me });
    expect(result.ok).toBe(false);
    expect(row(g.me).payMethods).toBeNull();
  });
});

describe('my payment details', () => {
  it('saves once and copies into every group', () => {
    const a = group('Goa');
    const b = group('Flat');
    const user = getOrCreateDeviceUserId(t.ctx);
    expect(myGroupCount(t.ctx, user)).toBe(2);

    const result = saveMyPayDetails(t.ctx, { deviceUserId: user, vpaInput: 'asha@okaxis', methods: [paypal] });
    expect(result).toMatchObject({ ok: true, value: { updatedGroups: 2 } });
    for (const id of [a.me, b.me]) {
      expect(row(id).upiVpa).toBe('asha@okaxis');
      expect(JSON.parse(row(id).payMethods!)).toEqual([paypal]);
    }
    expect(getMyPayDetails(t.ctx)).toEqual({ vpa: 'asha@okaxis', methods: [paypal] });
  });

  it('copies into a new group only when called for it', () => {
    const user = getOrCreateDeviceUserId(t.ctx);
    saveMyPayDetails(t.ctx, { deviceUserId: user, vpaInput: null, methods: [iban] });
    const c = group('Later');
    expect(row(c.me).payMethods).toBeNull();
    applyMyPayDetailsToGroup(t.ctx, user, c.groupId);
    expect(JSON.parse(row(c.me).payMethods!)).toEqual([iban]);
    expect(row(c.rahul).payMethods).toBeNull();
  });

  it('falls back to the last UPI ID saved in a group', () => {
    const g = group('Trip');
    setMemberUpiVpa(t.ctx, { memberId: g.me, vpaInput: 'asha@ybl', actorMemberId: g.me });
    expect(getMyPayDetails(t.ctx)).toEqual({ vpa: 'asha@ybl', methods: [] });
  });
});
