import { and, eq } from 'drizzle-orm';

import { createGroup } from '../repositories/groups';
import { activeMembersQuery } from '../repositories/members';
import { getLastOwnVpa, setMemberUpiVpa } from '../repositories/memberUpi';import { getOrCreateDeviceUserId } from '../repositories/profile';
import { activityLog, members } from '../schema';
import { createTestContext, type TestContext } from './testDb';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
});

afterEach(() => {
  t.close();
});

function setup() {
  const created = createGroup(t.ctx, {
    name: 'Trip',
    selfName: 'Asha',
    otherMemberNames: ['Rahul', 'Mom'],
    deviceUserId: getOrCreateDeviceUserId(t.ctx),
  });
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const { groupId, selfMemberId: me } = created.value;
  const rows = activeMembersQuery(t.ctx.db, groupId).all();
  const idOf = (name: string) => rows.find((m) => m.displayName === name)!.id;
  return { groupId, me, rahul: idOf('Rahul'), mom: idOf('Mom') };
}

const row = (id: string) => t.ctx.db.select().from(members).where(eq(members.id, id)).get()!;
const memberLog = (id: string) =>
  t.ctx.db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, 'member'), eq(activityLog.entityId, id)))
    .all();

describe('setMemberUpiVpa', () => {
  it('saves your own UPI ID normalized, marks it dirty and logs it masked', () => {
    const g = setup();
    t.ctx.db.update(members).set({ dirty: false, version: 1 }).where(eq(members.id, g.me)).run();

    expect(
      setMemberUpiVpa(t.ctx, { memberId: g.me, vpaInput: '  Asha.M@OKAXIS ', actorMemberId: g.me }),
    ).toEqual({ ok: true, value: { vpa: 'asha.m@okaxis' } });
    expect(row(g.me)).toMatchObject({ upiVpa: 'asha.m@okaxis', dirty: true, version: 1 });

    const log = memberLog(g.me);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      action: 'update',
      actorMemberId: g.me,
      before: { upiVpa: null },
      after: { upiVpa: 'as•••@okaxis' },
    });
  });

  it('lets any member set a placeholder’s UPI ID, including from a pasted UPI link', () => {
    const g = setup();
    const result = setMemberUpiVpa(t.ctx, {
      memberId: g.mom,
      vpaInput: 'upi://pay?pa=mom.k%40oksbi&pn=Mom',
      actorMemberId: g.me,
    });
    expect(result).toEqual({ ok: true, value: { vpa: 'mom.k@oksbi' } });
  });

  it('only the linked account can change a claimed member’s UPI ID', () => {
    const g = setup();
    t.ctx.db.update(members).set({ userId: 'user-rahul' }).where(eq(members.id, g.rahul)).run();

    expect(
      setMemberUpiVpa(t.ctx, { memberId: g.rahul, vpaInput: 'asha@ybl', actorMemberId: g.me }),
    ).toEqual({ ok: false, error: { code: 'NOT_ALLOWED' } });
    expect(row(g.rahul).upiVpa).toBeNull();
    expect(memberLog(g.rahul)).toHaveLength(0);
  });

  it('clears with blank input and skips no-op writes', () => {
    const g = setup();
    setMemberUpiVpa(t.ctx, { memberId: g.mom, vpaInput: 'mom@ybl', actorMemberId: g.me });
    setMemberUpiVpa(t.ctx, { memberId: g.mom, vpaInput: 'MOM@ybl', actorMemberId: g.me });
    expect(memberLog(g.mom)).toHaveLength(1);

    expect(setMemberUpiVpa(t.ctx, { memberId: g.mom, vpaInput: '  ', actorMemberId: g.me })).toEqual({
      ok: true,
      value: { vpa: null },
    });
    expect(row(g.mom).upiVpa).toBeNull();
    expect(memberLog(g.mom)).toHaveLength(2);
  });

  it.each<[string, object]>([
    ['rahul', { code: 'VPA_INVALID' }],
    ['rahul@ybl&am=1', { code: 'VPA_INVALID' }],
    [`${'a'.repeat(256)}@ybl`, { code: 'VPA_TOO_LONG', max: 255 }],
  ])('rejects %p', (vpaInput, error) => {
    const g = setup();
    expect(setMemberUpiVpa(t.ctx, { memberId: g.mom, vpaInput, actorMemberId: g.me })).toEqual({ ok: false, error });
  });

  it('rejects outsiders and removed members', () => {
    const g = setup();
    expect(
      setMemberUpiVpa(t.ctx, { memberId: g.mom, vpaInput: 'mom@ybl', actorMemberId: 'stranger' }),
    ).toEqual({ ok: false, error: { code: 'NOT_A_MEMBER' } });

    t.ctx.db.update(members).set({ deletedAt: 1 }).where(eq(members.id, g.mom)).run();
    expect(
      setMemberUpiVpa(t.ctx, { memberId: g.mom, vpaInput: 'mom@ybl', actorMemberId: g.me }),
    ).toEqual({ ok: false, error: { code: 'MEMBER_NOT_FOUND' } });
  });
    it('remembers only your own UPI ID for reuse in other groups', () => {
    const g = setup();
    setMemberUpiVpa(t.ctx, { memberId: g.mom, vpaInput: 'mom@ybl', actorMemberId: g.me });
    expect(getLastOwnVpa(t.ctx)).toBeNull();

    setMemberUpiVpa(t.ctx, { memberId: g.me, vpaInput: 'asha@okaxis', actorMemberId: g.me });
    expect(getLastOwnVpa(t.ctx)).toBe('asha@okaxis');

    setMemberUpiVpa(t.ctx, { memberId: g.me, vpaInput: null, actorMemberId: g.me });
    expect(getLastOwnVpa(t.ctx)).toBe('asha@okaxis'); // clearing in one group doesn't forget it
  });
});