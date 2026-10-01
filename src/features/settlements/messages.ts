import type { SettlementError } from '@/db/repositories/settlements';
import type { SettlementMethod } from '@/db/schema';

export const METHOD_LABELS: Record<SettlementMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  other: 'Other',
};

export function describeSettlementError(
  error: SettlementError,
  nameOf: (memberId: string) => string,
): string {
  switch (error.code) {
    case 'INVALID_AMOUNT':
      return 'Enter an amount between ₹0.01 and ₹1 crore.';
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