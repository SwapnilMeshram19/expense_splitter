import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/db/schema';
import { categoryLabelKey, MAX_CATEGORY_LABEL_LENGTH, normalizeCategoryLabel } from '@/domain/categoryLabel';

import { CATEGORY_NAMES } from './categoryNames';

/** Built-ins shown in the picker grid: every category except 'other', which is reached by name. */
export const PICKER_CATEGORIES: readonly Exclude<ExpenseCategory, 'other'>[] = EXPENSE_CATEGORIES.filter(
  (c): c is Exclude<ExpenseCategory, 'other'> => c !== 'other',
);

export interface CategoryOptions {
  builtIns: readonly Exclude<ExpenseCategory, 'other'>[];
  /** Custom names already used in the group, matching the query. */
  customs: readonly string[];
  /** The typed name, ready to add as a new custom category; null when it already exists or is invalid. */
  create: string | null;
  /** Typed name is too long. */
  tooLong: boolean;
}

/**
 * What the category sheet shows for a search query. Matching is case-insensitive and by
 * substring, so "gro" finds Groceries and "pet" finds a custom "Petrol". A built-in or custom name
 * that matches the query exactly suppresses the "Add" row (no duplicate "Food" custom category).
 */
export function categoryOptions(query: string, suggestions: readonly string[]): CategoryOptions {
  const normalized = normalizeCategoryLabel(query);
  const text = normalized.ok ? (normalized.label ?? '') : query.replace(/\s+/g, ' ').trim();
  const key = categoryLabelKey(text);

  // De-duplicate suggestions case-insensitively, keeping the first spelling.
  const seen = new Set<string>();
  const uniqueCustoms = suggestions.filter((s) => {
    const k = categoryLabelKey(s.trim());
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!key) return { builtIns: PICKER_CATEGORIES, customs: uniqueCustoms, create: null, tooLong: false };

  const builtIns = PICKER_CATEGORIES.filter((c) => categoryLabelKey(CATEGORY_NAMES[c]).includes(key));
  const customs = uniqueCustoms.filter((s) => categoryLabelKey(s).includes(key));
  const exists =
    PICKER_CATEGORIES.some((c) => categoryLabelKey(CATEGORY_NAMES[c]) === key) ||
    uniqueCustoms.some((s) => categoryLabelKey(s) === key);
  const tooLong = Array.from(text).length > MAX_CATEGORY_LABEL_LENGTH;

  return { builtIns, customs, create: exists || tooLong ? null : text, tooLong };
}
