import type { CommandError } from '@/domain/commands';
import { describeCommonFailure } from '@/features/data/messages';
import type { SettlementMethod } from '@/domain/model';
import {
  DEFAULT_CURRENCY,
  formatMoney,
  maxAmountLabel,
  minorDigits,
  usesIndianGroupingForInr,
  type CurrencyCode,
} from '@/domain/currency';

export const METHOD_LABELS: Record<SettlementMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  other: 'Other',
};

/** "₹0.01 and ₹100 crore" for INR in India; "$0.01 and $1,000,000,000" / "¥1 and …" elsewhere. */
function amountRange(currency: CurrencyCode): string {
  if (currency === 'INR' && usesIndianGroupingForInr()) return '₹0.01 and ₹100 crore';
  const smallest = formatMoney(1, currency, { forceDecimals: minorDigits(currency) > 0 });
  return `${smallest} and ${maxAmountLabel(currency)}`;
}

export function describeSettlementError(
  failure: CommandError<'settlement.add'> | { code: string },
  nameOf: (memberId: string) => string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  const error = failure as CommandError<'settlement.add'>;
  switch (error.code) {
    case 'INVALID_AMOUNT':
      return `Enter an amount between ${amountRange(currency)}.`;
    case 'SAME_PERSON':
      return 'Choose two different people.';
    case 'UNKNOWN_MEMBER':
      return `${nameOf(error.memberId)} is no longer in this group.`;
    case 'NOT_A_MEMBER':
      return 'You’re not a member of this group.';
    case 'NOTE_TOO_LONG':
      return `Keep the note under ${error.max} characters.`;
    case 'NOT_FOUND':
      return 'This payment no longer exists.';
    case 'INVALID_METHOD':
      return 'Choose how it was paid.';
    case 'INVALID_TIME':
      return 'Check the date and time on your phone, then try again.';
  }
  return describeCommonFailure(failure) ?? 'Couldn’t record the payment. Please try again.';
}
