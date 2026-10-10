import type { ExpenseError } from '@/db/repositories/expenses';
import { MAX_CATEGORY_LABEL_LENGTH } from '@/domain/categoryLabel';
import {
  DEFAULT_CURRENCY,
  formatMoney,
  maxAmountLabel,
  type CurrencyCode,
} from '@/domain/currency';
import type { ForeignError } from '@/domain/fx';
import { MAX_NOTE_LENGTH } from '@/domain/note';
import type { SplitError } from '@/domain/splits';

type NameOf = (memberId: string) => string;

/** Currencies amounts in an error are in: entry = how the bill was typed, group = balances. */
export interface ErrorCurrencies {
  entry: CurrencyCode;
  group: CurrencyCode;
}

const INR: ErrorCurrencies = { entry: DEFAULT_CURRENCY, group: DEFAULT_CURRENCY };

function describeSplitError(error: SplitError, nameOf: NameOf, currency: CurrencyCode): string {
  const money = (minor: number) => formatMoney(minor, currency);
  switch (error.code) {
    case 'INVALID_TOTAL':
      return `Enter an amount between ${money(1)} and ${maxAmountLabel(currency)}.`;
    case 'INVALID_SPLIT_TYPE':
      return 'This split type isn’t supported.';
    case 'NO_PARTICIPANTS':
      return 'Choose at least one person to split with.';
    case 'DUPLICATE_MEMBER':
      return `${nameOf(error.memberId)} appears twice in the split.`;
    case 'INVALID_VALUE':
      return error.memberId ? `Check the value for ${nameOf(error.memberId)}.` : 'Check the split values.';
    case 'EXACT_SUM_MISMATCH':
      return `Amounts add up to ${money(error.actual)}, but the total is ${money(error.expected)}.`;
    case 'PERCENT_SUM_MISMATCH':
      return 'Percentages must add up to exactly 100%.';
    case 'ITEM_UNASSIGNED':
      return `Item ${error.itemIndex + 1} isn’t assigned to anyone.`;
    case 'ITEM_INVALID':
      return `Item ${error.itemIndex + 1} has an invalid amount or people.`;
  }
}

function describeForeignError(error: ForeignError, currencies: ErrorCurrencies): string {
  switch (error.code) {
    case 'FX_SAME_CURRENCY':
      return `This bill is already in ${currencies.group}; no rate needed.`;
    case 'FX_UNKNOWN_CURRENCY':
      return 'This currency isn’t supported.';
    case 'FX_INVALID_AMOUNT':
      return `Enter an amount up to ${maxAmountLabel(currencies.entry)}.`;
    case 'FX_INVALID_RATE':
      return 'Enter a valid exchange rate.';
    case 'FX_TOTAL_ZERO':
      return `That rounds to ${formatMoney(0, currencies.group)}. Check the amount and rate.`;
    case 'FX_TOTAL_TOO_LARGE':
      return `That’s more than ${formatMoney(error.max, currencies.group)}. Split it into smaller expenses.`;
  }
}

export function describeExpenseError(
  error: ExpenseError,
  nameOf: NameOf,
  currencies: ErrorCurrencies = INR,
): string {
  const entry = (minor: number) => formatMoney(minor, currencies.entry);
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
      return `Paid amounts add up to ${entry(error.actual)}, but the total is ${entry(error.expected)}.`;
    case 'UNKNOWN_MEMBER':
      return `${nameOf(error.memberId)} is no longer in this group.`;
    case 'SPLIT':
      return describeSplitError(error.error, nameOf, currencies.entry);
    case 'UNKNOWN_CURRENCY':
      return 'This group’s currency isn’t supported by this version of the app. Update the app.';
    case 'FX':
      return describeForeignError(error.error, currencies);
    case 'FX_TOTAL_MISMATCH':
      return 'The converted total doesn’t match the rate. Re-enter the rate and try again.';
    case 'NOT_FOUND':
      return 'This expense no longer exists.';
    case 'GROUP_MISMATCH':
      return 'This expense belongs to a different group.';
    case 'NOT_A_MEMBER':
      return 'You’re not a member of this group.';
    case 'CATEGORY_LABEL_TOO_LONG':
      return `Keep the category name under ${MAX_CATEGORY_LABEL_LENGTH} characters.`;
    case 'NOTE_TOO_LONG':
      return `Keep the note under ${MAX_NOTE_LENGTH} characters.`;
    case 'INVALID_RECEIPT':
      return 'The receipt photo couldn’t be saved. Attach it again.';
  }
}