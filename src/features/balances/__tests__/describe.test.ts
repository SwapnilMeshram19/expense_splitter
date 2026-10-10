import { describeMyBalance, describeMyExpenseShare } from '../describe';

describe('balance text', () => {
  it('splits the amount from the words, in any currency', () => {
    expect(describeMyBalance(60000)).toEqual({
      label: 'you are owed ₹600',
      lead: 'you are owed',
      amount: '₹600',
      tone: 'positive',
    });
    expect(describeMyBalance(-1500, 'JPY')).toEqual({
      label: 'you owe ¥1,500',
      lead: 'you owe',
      amount: '¥1,500',
      tone: 'negative',
    });
    expect(describeMyBalance(0, 'USD')).toEqual({
      label: 'settled up',
      lead: 'settled up',
      amount: null,
      tone: 'neutral',
    });
  });

  it('describes my part of an expense', () => {
    expect(describeMyExpenseShare(1250, true, 'AED').label).toBe('you lent AED 12.50');
    expect(describeMyExpenseShare(-1250, true, 'KWD')).toMatchObject({ amount: 'KWD 1.250', tone: 'negative' });
    expect(describeMyExpenseShare(500, false, 'USD')).toMatchObject({ lead: 'not involved', amount: null });
    expect(describeMyExpenseShare(0, true)).toMatchObject({ lead: 'no balance', amount: null });
  });
});
