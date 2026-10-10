import type { ActivityLogEntry } from '@/db/schema';

import { describeActivity, type ActivityContext } from '../describeActivity';

const names: Record<string, string> = { me: 'Asha', r: 'Rahul' };
const usd: ActivityContext = { me: 'me', nameOf: (id) => names[id] ?? 'Someone', currency: 'USD' };
const inr: ActivityContext = { me: 'me', nameOf: (id) => names[id] ?? 'Someone' };

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

// A $25 bill in a rupee group, converted at 96.64 → ₹2,416.
const taxi = (patch: Record<string, unknown> = {}) => ({
  description: 'Taxi',
  amountPaise: 241600,
  category: 'travel',
  expenseDate: '2026-10-01',
  splitInput: { type: 'equal' },
  foreign: { currency: 'USD', amountMinor: 2500, rate: '96.64' },
  payers: [{ memberId: 'me', amountPaise: 241600 }],
  shares: [
    { memberId: 'me', amountPaise: 120800 },
    { memberId: 'r', amountPaise: 120800 },
  ],
  ...patch,
});

describe('describeActivity with currencies', () => {
  it('formats amounts in the group currency', () => {
    const payment = { fromMemberId: 'r', toMemberId: 'me', amountPaise: 1250, method: 'cash' };
    expect(describeActivity(entry({ entityType: 'settlement', after: payment }), usd).detail).toBe(
      'Rahul paid you $12.50 · Cash',
    );
    const lunch = { description: 'Lunch', amountPaise: 3000, payers: [{ memberId: 'me', amountPaise: 3000 }] };
    expect(describeActivity(entry({ after: lunch }), usd).detail).toBe('$30 · paid by you');
  });

  it('shows a foreign bill in its own currency with the converted amount', () => {
    expect(describeActivity(entry({ after: taxi() }), inr)).toEqual({
      title: 'You added “Taxi”',
      detail: '$25 (₹2,416) · paid by you',
    });
  });

  it('describes a changed rate or bill amount', () => {
    const before = taxi();
    const after = taxi({
      amountPaise: 245000,
      foreign: { currency: 'USD', amountMinor: 2500, rate: '98' },
    });
    expect(describeActivity(entry({ action: 'update', before, after }), inr).detail).toBe(
      '$25 (₹2,416) → $25 (₹2,450)',
    );
  });

  it('ignores a malformed foreign part', () => {
    const odd = taxi({ foreign: { currency: 'XXX', amountMinor: 'lots' } });
    expect(describeActivity(entry({ after: odd }), inr).detail).toBe('₹2,416 · paid by you');
  });

  it('describes group currency choices', () => {
    expect(
      describeActivity(entry({ entityType: 'group', after: { name: 'Bali', currency: 'IDR' } }), inr),
    ).toEqual({ title: 'You created the group “Bali”', detail: 'Currency: IDR · Indonesian rupiah' });
    expect(
      describeActivity(entry({ entityType: 'group', after: { name: 'Flat', currency: 'INR' } }), inr).detail,
    ).toBeNull();
    expect(
      describeActivity(
        entry({ entityType: 'group', action: 'update', before: { currency: 'INR' }, after: { currency: 'THB' } }),
        inr,
      ),
    ).toEqual({ title: 'You changed the group’s currency', detail: 'INR → THB' });
  });
});
