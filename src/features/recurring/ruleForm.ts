import type { Expense, RecurringRule } from '@/db/schema';
import { formStateFromExpense, type ExpenseFormState } from '@/features/expenses/formState';

/** The expense form, filled from a rule (the rule's start date shows as the first date). */
export function formStateFromRule(
  rule: RecurringRule,
  memberIds: readonly string[],
  selfMemberId: string,
  groupCurrency: string,
): ExpenseFormState {
  const asExpense: Expense = {
    id: rule.id,
    groupId: rule.groupId,
    description: rule.description,
    amountPaise: rule.amountPaise,
    category: rule.category,
    categoryLabel: rule.categoryLabel,
    expenseDate: rule.startDate,
    splitInput: rule.splitInput,
    originalCurrency: null,
    originalAmountMinor: null,
    fxRate: null,
    note: rule.note,
    receiptId: null,
    recurringRuleId: null,
    occurrenceDate: null,
    createdByMemberId: rule.createdByMemberId,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    deletedAt: rule.deletedAt,
    version: rule.version,
    dirty: rule.dirty,
  };
  return {
    ...formStateFromExpense(
      { expense: asExpense, payers: rule.payers, shares: rule.shares },
      memberIds,
      selfMemberId,
      groupCurrency,
    ),
    repeat: rule.frequency,
    repeatEndDate: rule.endDate,
  };
}
