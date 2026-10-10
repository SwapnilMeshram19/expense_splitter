import type { SettlementError } from '@/db/repositories/settlements';
import type { SettlementMethod } from '@/db/schema';
import {
  DEFAULT_CURRENCY,
  formatMoney,
  maxAmountLabel,
  minorDigits,
  type CurrencyCode,
} from '@/domain/currency';

export const METHOD_LABELS: Record<SettlementMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  other: 'Other',
};

/** "₹0.01 and ₹1 crore" for INR (unchanged wording); "$0.01 and $10,000,000" / "¥1 and …" elsewhere. */
function amountRange(currency: CurrencyCode): string {
  if (currency === 'INR') return '₹0.01 and ₹1 crore';
  const smallest = formatMoney(1, currency, { forceDecimals: minorDigits(currency) > 0 });
  return `${smallest} and ${maxAmountLabel(currency)}`;
}

export function describeSettlementError(
  error: SettlementError,
  nameOf: (memberId: string) => string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
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
  }
}
