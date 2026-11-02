import type { CommandError } from '@/domain/commands';
import { formatMoney } from '@/domain/currency';
import { describeFailure } from '@/features/data/messages';
import { describeExpenseError } from '@/features/expenses/messages';

type HouseholdFailure =
  | CommandError<'household.create'>
  | CommandError<'household.mark'>
  | CommandError<'household.postBill'>
  | { code: string };

/** Text for anything a home-services save can fail with. */
export function describeHouseholdError(
  failure: HouseholdFailure,
  nameOf: (memberId: string) => string,
  currency: string,
): string {
  return describeFailure(failure as { code: string }, (e) => {
    const error = e as HouseholdFailure & Record<string, unknown>;
    switch (error.code) {
      case 'NAME_REQUIRED':
        return 'Give it a name, like Milk or Maid.';
      case 'NAME_TOO_LONG':
        return `Keep the name under ${String(error.max)} letters.`;
      case 'DUPLICATE_NAME':
        return `There’s already a “${String(error.name)}”. Use another name.`;
      case 'INVALID_KIND':
      case 'INVALID_UNIT':
        return 'Choose how it’s paid.';
      case 'INVALID_QTY':
        return 'That amount isn’t possible here.';
      case 'INVALID_RATE':
        return `Enter a price up to ${formatMoney(Number(error.max), currency)}.`;
      case 'INVALID_RATES':
        return 'Check the price and the start date.';
      case 'NO_WEEKDAYS':
        return 'Pick at least one day of the week.';
      case 'INVALID_LEAVES':
        return 'Paid leaves can be 0 to 31 a month.';
      case 'INVALID_DATES':
        return 'The end date is before the start date.';
      case 'TOO_MANY_SERVICES':
        return `A group can track up to ${String(error.max)} services.`;
      case 'OUT_OF_RANGE':
        return 'That day can’t be changed: it’s outside the service’s dates or too far back or ahead.';
      case 'NOT_SCHEDULED':
        return 'That’s a day off anyway.';
      case 'MARK_CONFLICT':
        return 'Someone just changed this day. It’s been updated: check it and try again.';
      case 'INVALID_MONTH':
        return 'This month can’t be billed.';
      case 'NOTHING_TO_BILL':
        return 'Nothing to bill for this month yet.';
      case 'BILL_TOO_LARGE':
        return `The bill is over ${formatMoney(Number(error.max), currency)}. Check the price and quantities.`;
      case 'NOT_FOUND':
        return 'This service no longer exists.';
      default: {
        const text = describeExpenseError(error as CommandError<'expense.add'>, nameOf, {
          entry: currency,
          group: currency,
        });
        return text || null;
      }
    }
  });
}
