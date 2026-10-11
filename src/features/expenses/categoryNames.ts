import type { ExpenseCategory } from '@/db/schema';

/** Display names of the built-in categories. Plain data, so exports and tests can use it. */
export const CATEGORY_NAMES: Record<ExpenseCategory, string> = {
  general: 'General',
  food: 'Food & drinks',
  groceries: 'Groceries',
  travel: 'Travel',
  transport: 'Transport',
  stay: 'Stay',
  shopping: 'Shopping',
  utilities: 'Utilities',
  entertainment: 'Entertainment',
  other: 'Other',
};

/**
 * What a category reads as: the custom name for 'other' + label ("Petrol"), else the built-in
 * name. Unknown categories (a newer app version via sync) read as "Other".
 */
export function categoryDisplayName(category: string, label: string | null | undefined): string {
  if (category === 'other' && label) return label;
  return CATEGORY_NAMES[category as ExpenseCategory] ?? CATEGORY_NAMES.other;
}
