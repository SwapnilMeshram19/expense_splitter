import type { RuleError } from '@/db/repositories/recurring';
import type { ScheduleError } from '@/domain/recurrence';
import { describeExpenseError } from '@/features/expenses/messages';

const SCHEDULE: Record<ScheduleError, string> = {
  INVALID_FREQUENCY: 'Choose how often it repeats.',
  INVALID_START: 'Pick a valid first date.',
  INVALID_END: 'Pick a valid end date.',
  END_BEFORE_START: 'The end date is before the first date.',
};

export function describeRuleError(
  error: RuleError,
  nameOf: (memberId: string) => string,
  currency: string,
): string {
  switch (error.code) {
    case 'SCHEDULE':
      return SCHEDULE[error.error];
    case 'SCHEDULE_LOCKED':
      return 'How often and from when can’t change once it has started. Stop this one and add a new repeating expense.';
    case 'INVALID_TIME_ZONE':
      return 'Your phone’s time zone isn’t recognised. Check the date and time settings.';
    default:
      return describeExpenseError(error, nameOf, { entry: currency, group: currency });
  }
}
