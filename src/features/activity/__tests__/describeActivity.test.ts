import type { ActivityLogEntry } from '@/db/schema';

import { describeActivity, formatTimestamp, type ActivityContext } from '../describeActivity';

const names: Record<string, string> = { me: 'Asha', r: 'Rahul', p: 'Priya' };
const ctx: ActivityContext = { me: 'me', nameOf: (id) => names[id] ?? 'Someone' };

const entry = (patch: Partial<ActivityLogEntry>): ActivityLogEntry => ({
  id: 'l1',
  groupId: 'g',
  entityType: 'expense',
  entityId: 'e1',
  action: 'create',
  actorMemberId: 'me',
  before: null,
  after: null,
  createdAt: 0,
  dirty: true,
  ...patch,
});

const dinner = (patch: Record<string, unknown> = {}) => ({
  description: 'Dinner',
  amountPaise: 90000,
  category: 'food',
  expenseDate: '2026-10-01',
  splitInput: { type: 'equal' },
  payers: [{ memberId: 'me', amountPaise: 90000 }],
  shares: [
    { memberId: 'me', amountPaise: 45000 },
    { memberId: 'r', amountPaise: 45000 },
  ],
  ...patch,
});

describe('describeActivity', () => {
  it('describes a new expense', () => {
    expect(describeActivity(entry({ after: dinner() }), ctx)).toEqual({
      title: 'You added “Dinner”',
      detail: '₹900 · paid by you',
    });
  });

  it('shows only the fields that changed on an edit', () => {
    const result = describeActivity(
      entry({
        action: 'update',
        before: dinner(),
        after: dinner({
          amountPaise: 60000,
          payers: [{ memberId: 'r', amountPaise: 60000 }],
          shares: [
            { memberId: 'me', amountPaise: 30000 },
            { memberId: 'r', amountPaise: 30000 },
          ],
        }),
      }),
      ctx,
    );
    expect(result).toEqual({
      title: 'You changed “Dinner”',
      detail: '₹900 → ₹600 · paid by you → Rahul · split changed',
    });
  });

  it('describes split type and date changes', () => {
    const result = describeActivity(
      entry({
        action: 'update',
        actorMemberId: 'r',
        before: dinner(),
        after: dinner({ expenseDate: '2026-10-02', splitInput: { type: 'percentage' } }),
      }),
      ctx,
    );
    expect(result.title).toBe('Rahul changed “Dinner”');
    expect(result.detail).toBe('1 Oct 2026 → 2 Oct 2026 · split equally → percentages');
  });

  it('describes a deleted expense', () => {
    expect(describeActivity(entry({ action: 'delete', before: dinner() }), ctx)).toEqual({
      title: 'You deleted “Dinner”',
      detail: '₹900',
    });
  });

  it('describes payments with you in the right grammatical position', () => {
    const payment = { fromMemberId: 'r', toMemberId: 'me', amountPaise: 30000, method: 'cash' };
    expect(describeActivity(entry({ entityType: 'settlement', after: payment }), ctx)).toEqual({
      title: 'You recorded a payment',
      detail: 'Rahul paid you ₹300 · Cash',
    });
    expect(
      describeActivity(entry({ entityType: 'settlement', action: 'delete', before: payment }), ctx),
    ).toEqual({ title: 'You deleted a payment', detail: 'Rahul → you ₹300' });
  });

  it('describes member and group changes', () => {
    expect(
      describeActivity(
        entry({
          entityType: 'member',
          action: 'update',
          before: { displayName: 'Rahul' },
          after: { displayName: 'Rahul K' },
        }),
        ctx,
      ).title,
    ).toBe('You renamed Rahul to Rahul K');
    expect(
      describeActivity(
        entry({ entityType: 'group', action: 'update', before: { simplifyDebts: true }, after: { simplifyDebts: false } }),
        ctx,
      ).title,
    ).toBe('You turned debt simplification off');
    expect(
      describeActivity(entry({ entityType: 'group', action: 'delete', actorMemberId: null }), ctx).title,
    ).toBe('Someone deleted the group');
  });

  it('degrades gracefully on malformed snapshots', () => {
    expect(describeActivity(entry({ after: { description: 42 } }), ctx)).toEqual({
      title: 'You made a change',
      detail: null,
    });
    expect(describeActivity(entry({ entityType: 'settlement', after: 'garbage' }), ctx).title).toBe(
      'You made a change',
    );
  });
});

describe('formatTimestamp', () => {
  it('formats local date and 12-hour time', () => {
    expect(formatTimestamp(new Date(2026, 9, 1, 14, 5).getTime())).toBe('1 Oct 2026, 2:05 pm');
    expect(formatTimestamp(new Date(2026, 9, 1, 0, 30).getTime())).toBe('1 Oct 2026, 12:30 am');
  });
});
it('describes UPI ID changes with masked IDs', () => {
  const upi = (patch: Partial<ActivityLogEntry>) =>
    describeActivity(entry({ entityType: 'member', action: 'update', entityId: 'r', ...patch }), ctx);

  expect(upi({ actorMemberId: 'r', before: { upiVpa: null }, after: { upiVpa: 'ra•••@ybl' } })).toEqual({
    title: 'Rahul added their UPI ID',
    detail: 'ra•••@ybl',
  });
  expect(upi({ before: { upiVpa: 'ra•••@ybl' }, after: { upiVpa: 'ro•••@ybl' } })).toEqual({
    title: 'You changed Rahul’s UPI ID',
    detail: 'ra•••@ybl → ro•••@ybl',
  });
  expect(upi({ entityId: 'me', before: { upiVpa: 'as•••@ybl' }, after: { upiVpa: null } })).toEqual({
    title: 'You removed your UPI ID',
    detail: 'as•••@ybl',
  });
});

  it('describes restores made by the server', () => {
    expect(
      describeActivity(
        entry({
          entityType: 'member',
          action: 'restore',
          entityId: 'r',
          actorMemberId: null,
          after: { displayName: 'Rahul', reason: 'MEMBER_HAS_BALANCE' },
        }),
        ctx,
      ),
    ).toEqual({ title: 'Rahul was added back', detail: 'They can’t be removed while they still owe or are owed money.' });
    expect(
      describeActivity(
        entry({ entityType: 'group', action: 'restore', actorMemberId: null, after: { reason: 'GROUP_HAS_BALANCES' } }),
        ctx,
      ),
    ).toEqual({ title: 'The group was restored', detail: 'It can’t be deleted while balances aren’t settled.' });
  });