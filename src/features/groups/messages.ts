import type { CommandError } from '@/domain/commands';
import { DEFAULT_CURRENCY, formatMoney, type CurrencyCode } from '@/domain/currency';
import type { NameError } from '@/domain/names';
import { describeCommonFailure } from '@/features/data/messages';
import { describePayDetailsError } from '@/features/payments/messages';

export function describeNameError(error: NameError, subject: string): string {
  switch (error.code) {
    case 'NAME_REQUIRED':
      return `${subject} is required.`;
    case 'NAME_TOO_LONG':
      return `${subject} can be at most ${error.max} characters.`;
    case 'DUPLICATE_NAME':
      return `"${error.name}" is already in this group. Use a different name.`;
  }
}

type Failure = { code: string };

export function describeGroupError(error: CommandError<'group.create'> | Failure): string {
  const e = error as CommandError<'group.create'>;
  switch (e.code) {
    case 'INVALID_GROUP_NAME':
      return describeNameError(e.error, 'Group name');
    case 'INVALID_MEMBER_NAME':
      return describeNameError(e.error, 'Each name');
    case 'UNKNOWN_CURRENCY':
      return 'Pick a supported currency.';
  }
  return describeCommonFailure(error) ?? describePayDetailsError(error as never, 'You');
}

export function describeGroupUpdateError(error: CommandError<'group.update'> | Failure, currency: CurrencyCode = DEFAULT_CURRENCY): string {
  const e = error as CommandError<'group.update'>;
  switch (e.code) {
    case 'NAME_REQUIRED':
    case 'NAME_TOO_LONG':
    case 'DUPLICATE_NAME':
      return describeNameError(e, 'Group name');
    case 'UNKNOWN_CURRENCY':
      return 'Pick a supported currency.';
    case 'CURRENCY_LOCKED':
      return 'Currency is locked once the group has expenses. Add foreign bills with their own rate.';
    case 'INVALID_BUDGET':
      return `Enter a budget up to ${formatMoney(e.max, currency)}.`;
  }
  return describeCommonFailure(error) ?? 'Couldn’t save that. Please try again.';
}

export function describeGroupDeleteError(error: CommandError<'group.delete'> | Failure): string {
  const e = error as CommandError<'group.delete'>;
  if (e.code === 'UNSETTLED_BALANCES') return `${e.count} people still have balances. Settle up first.`;
  if (e.code === 'NOT_A_MEMBER') return 'You can only delete groups you’re a member of.';
  return describeCommonFailure(error) ?? 'Couldn’t delete the group. Please try again.';
}

export function describeMemberError(
  error: CommandError<'member.add' | 'member.update' | 'member.remove'> | Failure,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  const e = error as CommandError<'member.add'>;
  switch (e.code) {
    case 'NAME_REQUIRED':
    case 'NAME_TOO_LONG':
    case 'DUPLICATE_NAME':
      return describeNameError(e, 'Name');
    case 'CANNOT_REMOVE_SELF':
      return 'You can’t remove yourself.';
    case 'MEMBER_HAS_BALANCE':
      return e.balancePaise < 0
        ? `They still owe ${formatMoney(-e.balancePaise, currency)}. Settle up first.`
        : `They are still owed ${formatMoney(e.balancePaise, currency)}. Settle up first.`;
    case 'NOT_FOUND':
      return 'This person is no longer in the group.';
  }
  return describeCommonFailure(error) ?? describePayDetailsError(error as never, 'them');
}
