import { setIndianGroupingForInr } from '@/domain/currency';

import { describeSettlementError } from '../messages';

const nameOf = () => 'Rahul';

describe('describeSettlementError', () => {
  it('states the allowed range in the group currency', () => {
    const error = { code: 'INVALID_AMOUNT' } as const;
    expect(describeSettlementError(error, nameOf)).toBe('Enter an amount between ₹0.01 and ₹1 crore.');
    expect(describeSettlementError(error, nameOf, 'USD')).toBe(
      'Enter an amount between $0.01 and $10,000,000.',
    );
    expect(describeSettlementError(error, nameOf, 'JPY')).toBe(
      'Enter an amount between ¥1 and ¥10,000,000.',
    );
    expect(describeSettlementError(error, nameOf, 'KWD')).toBe(
      'Enter an amount between KWD 0.001 and KWD 10,000,000.',
    );
  });

  it('uses thousands for rupees outside India', () => {
    setIndianGroupingForInr(false);
    try {
      expect(describeSettlementError({ code: 'INVALID_AMOUNT' }, nameOf)).toBe(
        'Enter an amount between ₹0.01 and ₹10,000,000.',
      );
    } finally {
      setIndianGroupingForInr(true);
    }
  });
});
