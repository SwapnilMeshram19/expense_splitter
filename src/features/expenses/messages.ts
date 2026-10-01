import type { ExpenseError } from '@/db/repositories/expenses';
import { formatPaise } from '@/domain/money';
import type { SplitError } from '@/domain/splits';

type NameOf = (memberId: string) => string;

function describeSplitError(error: SplitError, nameOf: NameOf): string {
  switch (error.code) {
    case 'INVALID_TOTAL':
      return 'Enter an amount between ₹0.01 and ₹1 crore.';
    case 'INVALID_SPLIT_TYPE':
      return 'This split type isn’t supported.';
    case 'NO_PARTICIPANTS':
      return 'Choose at least one person to split with.';
    case 'DUPLICATE_MEMBER':
      return `${nameOf(error.memberId)} appears twice in the split.`;
    case 'INVALID_VALUE':
      return error.memberId ? `Check the value for ${nameOf(error.memberId)}.` : 'Check the split values.';
    case 'EXACT_SUM_MISMATCH':
      return `Amounts add up to ${formatPaise(error.actual)}, but the total is ${formatPaise(error.expected)}.`;
    case 'PERCENT_SUM_MISMATCH':
      return 'Percentages must add up to exactly 100%.';
    case 'ITEM_UNASSIGNED':
      return `Item ${error.itemIndex + 1} isn’t assigned to anyone.`;
    case 'ITEM_INVALID':
      return `Item ${error.itemIndex + 1} has an invalid amount or people.`;
  }
}

export function describeExpenseError(error: ExpenseError, nameOf: NameOf): string {
  switch (error.code) {
    case 'DESCRIPTION_REQUIRED':
      return 'Enter a description.';
    case 'DESCRIPTION_TOO_LONG':
      return `Keep the description under ${error.max} characters.`;
    case 'INVALID_DATE':
      return 'Pick a valid date.';
    case 'INVALID_PAYERS':
      return 'Check who paid.';
    case 'PAYER_SUM_MISMATCH':
      return `Paid amounts add up to ${formatPaise(error.actual)}, but the total is ${formatPaise(error.expected)}.`;
    case 'UNKNOWN_MEMBER':
      return `${nameOf(error.memberId)} is no longer in this group.`;
    case 'SPLIT':
      return describeSplitError(error.error, nameOf);
    case 'NOT_FOUND':
      return 'This expense no longer exists.';
    case 'GROUP_MISMATCH':
      return 'This expense belongs to a different group.';
    case 'NOT_A_MEMBER':
      return 'You’re not a member of this group.';
  }
}