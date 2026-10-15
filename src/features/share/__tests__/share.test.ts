import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { createExpense, deleteExpense } from '@/db/repositories/expenses';
import { createGroup } from '@/db/repositories/groups';
import { activeMembersQuery } from '@/db/repositories/members';
import { getOrCreateDeviceUserId } from '@/db/repositories/profile';
import { loadGroupView } from '@/features/groups/loadGroupView';

import { expenseShareText } from '../loaders';
import {
  balancesMessage,
  expenseMessage,
  MAX_LIST_LINES,
  oneLine,
  reminderMessage,
  SHARE_FOOTER,
  spendingMessage,
} from '../messages';
import { clampShareText, MAX_SHARE_TEXT, whatsappSendUrl } from '../whatsapp';

const names = new Map([
  ['a', 'Asha'],
  ['r', 'Rahul'],
  ['p', 'Priya'],
]);

describe('balancesMessage', () => {
  it('lists payments and the receivers’ UPI IDs once each', () => {
    const text = balancesMessage({
      groupName: 'Goa\ntrip',
      currency: 'INR',
      transfers: [
        { fromMemberId: 'r', toMemberId: 'a', amountPaise: 125000 },
        { fromMemberId: 'p', toMemberId: 'a', amountPaise: 30050 },
      ],
      names,
      upiIds: new Map([
        ['a', 'asha@okicici'],
        ['r', 'rahul@ybl'],
      ]),
      totalSpent: 1560000,
      expenseCount: 30,
    });
    expect(text).toBe(
      [
        '*Goa trip*',
        'Spent so far: *₹15,600* (30 expenses)',
        '',
        'To settle up:',
        '• Rahul → Asha: *₹1,250*',
        '• Priya → Asha: *₹300.50*',
        '',
        'UPI:',
        '• Asha: asha@okicici',
        '',
        SHARE_FOOTER,
      ].join('\n'),
    );
  });

  it('leaves UPI out for other currencies and says when everyone is settled', () => {
    const base = {
      groupName: 'Paris',
      names,
      upiIds: new Map([['a', 'asha@okicici']]),
      totalSpent: 0,
      expenseCount: 0,
    };
    const eur = balancesMessage({
      ...base,
      currency: 'EUR',
      transfers: [{ fromMemberId: 'r', toMemberId: 'a', amountPaise: 1050 }],
    });
    expect(eur).toContain('€10.50');
    expect(eur).not.toContain('UPI');
    expect(eur).not.toContain('Spent so far');
    const settled = balancesMessage({ ...base, currency: 'INR', transfers: [] });
    expect(settled).toContain('Everyone is settled up');
  });

  it('caps a long list', () => {
    const transfers = Array.from({ length: 20 }, (_, i) => ({
      fromMemberId: `m${i}`,
      toMemberId: 'a',
      amountPaise: 100,
    }));
    const lines = balancesMessage({
      groupName: 'Big',
      currency: 'INR',
      transfers,
      names,
      upiIds: new Map(),
      totalSpent: 2000,
      expenseCount: 1,
    }).split('\n');
    expect(lines.filter((l) => l.startsWith('• '))).toHaveLength(MAX_LIST_LINES - 1);
    expect(lines).toContain(`…and ${20 - (MAX_LIST_LINES - 1)} more`);
    expect(lines).toContain('• Someone → Asha: *₹1*');
  });
});

describe('expenseMessage', () => {
  const base = {
    groupName: 'Goa',
    currency: 'INR',
    description: 'Dinner',
    amountPaise: 240000,
    original: null,
    date: '2026-10-05',
    categoryName: 'Food & drinks',
    note: null,
    payers: [{ name: 'Asha', amountPaise: 240000 }],
    shares: [
      { name: 'Asha', amountPaise: 120000 },
      { name: 'Rahul', amountPaise: 120000 },
      { name: 'Priya', amountPaise: 0 },
    ],
  };

  it('shows the bill, payer and shares (skipping zero shares)', () => {
    expect(expenseMessage(base)).toBe(
      [
        '*Dinner*: *₹2,400*',
        'Goa · Food & drinks · 5 Oct 2026',
        'Paid by Asha',
        '',
        'Shares:',
        '• Asha: ₹1,200',
        '• Rahul: ₹1,200',
        '',
        SHARE_FOOTER,
      ].join('\n'),
    );
  });

  it('shows a foreign bill, several payers and the note on one line', () => {
    const text = expenseMessage({
      ...base,
      original: { currency: 'USD', amountMinor: 2875 },
      payers: [
        { name: 'Asha', amountPaise: 140000 },
        { name: 'Rahul', amountPaise: 100000 },
      ],
      note: 'Table 4\nincl. tip',
    });
    expect(text).toContain('*Dinner*: *$28.75 (₹2,400)*');
    expect(text).toContain('Paid by Asha ₹1,400, Rahul ₹1,000');
    expect(text).toContain('Note: Table 4 incl. tip');
  });
});

describe('reminderMessage', () => {
  it('includes the amount and my UPI ID for INR', () => {
    expect(
      reminderMessage({
        groupName: 'Flat 302',
        currency: 'INR',
        debtorName: 'Rahul',
        amountPaise: 125000,
        upiId: 'asha@okicici',
      }),
    ).toBe(
      [
        'Hi Rahul, a gentle reminder to settle *₹1,250* for “Flat 302”.',
        'You can pay me on UPI: asha@okicici',
        'Thanks! 🙏',
        '',
        SHARE_FOOTER,
      ].join('\n'),
    );
  });

  it('works without an amount or outside INR', () => {
    const text = reminderMessage({
      groupName: 'Paris',
      currency: 'EUR',
      debtorName: 'Rahul',
      amountPaise: null,
      upiId: 'asha@okicici',
    });
    expect(text.startsWith('Hi Rahul, a gentle reminder to settle for “Paris”.')).toBe(true);
    expect(text).not.toContain('UPI');
  });
});

describe('spendingMessage', () => {
  it('gives the total and up to five categories', () => {
    const categories = ['A', 'B', 'C', 'D', 'E', 'F'].map((name, i) => ({
      name,
      total: 1000 - i * 100,
      percent: 10,
    }));
    const text = spendingMessage({
      groupName: 'Flat',
      currency: 'INR',
      periodName: 'October 2026',
      total: 4500,
      count: 1,
      categories,
    });
    expect(text).toContain('*Flat* · October 2026');
    expect(text).toContain('Spent: *₹45* (1 expense)');
    expect(text).toContain('• E: ₹6 (10%)');
    expect(text).not.toContain('• F');
  });
});

describe('whatsapp links', () => {
  it('encodes the text', () => {
    expect(whatsappSendUrl('Hi & bye\n₹1 #1')).toBe(
      `whatsapp://send?text=${encodeURIComponent('Hi & bye\n₹1 #1')}`,
    );
  });

  it('clamps long texts at a line end', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(10)}`).join('\n');
    const clamped = clampShareText(text);
    expect(clamped.length).toBeLessThanOrEqual(MAX_SHARE_TEXT);
    expect(clamped.endsWith('x…')).toBe(true);
    expect(clampShareText('short')).toBe('short');
    expect(clampShareText('y'.repeat(50), 10)).toBe(`${'y'.repeat(9)}…`);
  });

  it('collapses whitespace in one-liners', () => {
    expect(oneLine('  a \n\n b\tc ')).toBe('a b c');
  });
});

describe('with the database', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });
  afterEach(() => t.close());

  it('builds the expense text from saved data and the group view carries total and UPI IDs', () => {
    const deviceUserId = getOrCreateDeviceUserId(t.ctx);
    const created = createGroup(t.ctx, {
      name: 'Goa',
      selfName: 'Asha',
      otherMemberNames: ['Rahul'],
      deviceUserId,
    });
    if (!created.ok) throw new Error('createGroup failed');
    const { groupId, selfMemberId: me } = created.value;
    const rahul = activeMembersQuery(t.ctx.db, groupId)
      .all()
      .find((m) => m.displayName === 'Rahul')!.id;

    const result = createExpense(t.ctx, {
      groupId,
      description: 'Scooty',
      amountPaise: 90000,
      category: 'transport',
      expenseDate: '2026-10-05',
      payers: [{ memberId: me, amountPaise: 90000 }],
      splitInput: { type: 'equal', memberIds: [me, rahul] },
      actorMemberId: me,
    });
    if (!result.ok) throw new Error('createExpense failed');

    const text = expenseShareText(t.ctx.db, result.value.expenseId)!;
    expect(text).toContain('*Scooty*: *₹900*');
    expect(text).toContain('Goa · Transport · 5 Oct 2026');
    expect(text).toContain('• Asha: ₹450');

    const view = loadGroupView(t.ctx.db, groupId, deviceUserId, '2026-10-10')!;
    expect(view.totalSpent).toBe(90000);
    expect(view.upiIds.size).toBe(0);

    expect(deleteExpense(t.ctx, result.value.expenseId, me).ok).toBe(true);
    expect(expenseShareText(t.ctx.db, result.value.expenseId)).toBeNull();
    expect(expenseShareText(t.ctx.db, 'missing')).toBeNull();
  });
});

describe('reminderMessage with other ways to pay', () => {
  it('lists UPI in rupees for a foreign group, then the other ways', () => {
    const text = reminderMessage({
      groupName: 'Bangkok',
      currency: 'THB',
      debtorName: 'Rahul',
      amountPaise: 150000,
      upiId: 'asha@okaxis',
      inrPaise: 364500,
      otherWays: ['PromptPay: 0812345678'],
    });
    expect(text).toContain('settle *฿1,500*');
    expect(text).toContain('pay me ₹3,645 on UPI: asha@okaxis');
    expect(text).toContain('Or:\n• PromptPay: 0812345678');
  });

  it('leaves UPI out of a foreign group without a rate', () => {
    const text = reminderMessage({
      groupName: 'Paris',
      currency: 'EUR',
      debtorName: 'Rahul',
      amountPaise: 1250,
      upiId: 'asha@okaxis',
      otherWays: ['PayPal: https://paypal.me/asha/12.50EUR'],
    });
    expect(text).not.toContain('UPI');
    expect(text).toContain('You can pay me here:\n• PayPal');
  });
});
