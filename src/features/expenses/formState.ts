/**
 * Pure logic behind the expense form: parsing inputs, live feedback (remaining amount,
 * remaining %), previews, and building the draft to save. No React here, so it is unit-tested
 * directly. Final previews come from computeSplit, the same function that validates on save.
 */
import type { ExpenseDetail } from '@/db/repositories/expenses';
import type { ExpenseCategory, StoredSplitInput } from '@/db/schema';
import type { PayerLine } from '@/domain/balances';
import { MAX_CATEGORY_LABEL_LENGTH, normalizeCategoryLabel } from '@/domain/categoryLabel';
import {
  formatPaise,
  paiseToInputString,
  parseRupeesToPaise,
  sanitizeAmountInput,
  type Paise,
} from '@/domain/money';
import {
  BASIS_POINTS_TOTAL,
  computeSplit,
  parsePercentToBasisPoints,
  type SplitInput,
  type WeightedEntry,
} from '@/domain/splits';

export type SplitMode = 'equal' | 'exact' | 'percentage' | 'shares';
export type PayerMode = 'single' | 'multiple';
type ValueMap = Record<string, string>;

export interface FormMember {
  id: string;
  name: string;
}

export interface ExpenseFormState {
  description: string;
  amountText: string;
  expenseDate: string;
  category: ExpenseCategory;
  /** Custom category name, typed when category is 'other' ('' = plain "Other"). */
  categoryLabel: string;
  payerMode: PayerMode;
  singlePayerId: string;
  payerAmounts: ValueMap;
  splitMode: SplitMode;
  equalMemberIds: string[];
  exactAmounts: ValueMap;
  percentages: ValueMap;
  shares: ValueMap;
}

export interface DraftParts {
  description: string;
  amountPaise: Paise;
  expenseDate: string;
  category: ExpenseCategory;
  /** Normalised custom name, or null. Always null unless category is 'other'. */
  categoryLabel: string | null;
  payers: PayerLine[];
  splitInput: StoredSplitInput;
}

export interface FormAnalysis {
  totalPaise: Paise | null;
  /**
   * Amount per member to show next to each row. Exact (what will be saved) once the split
   * is valid; while the user is still typing it shows partial values (see previewIsEstimate).
   */
  preview: Map<string, Paise>;
  /** True when preview values are rounded estimates (percentages not yet summing to 100%). */
  previewIsEstimate: boolean;
  splitHint: string | null;
  payerHint: string | null;
  /** Human-readable problems, first one shown on save. Empty when the form is valid. */
  problems: string[];
  draft: DraftParts | null;
}

export function initialFormState(
  memberIds: readonly string[],
  selfMemberId: string,
  today: string,
): ExpenseFormState {
  return {
    description: '',
    amountText: '',
    expenseDate: today,
    category: 'general',
    categoryLabel: '',
    payerMode: 'single',
    singlePayerId: selfMemberId,
    payerAmounts: {},
    splitMode: 'equal',
    equalMemberIds: [...memberIds],
    exactAmounts: {},
    percentages: {},
    shares: Object.fromEntries(memberIds.map((id) => [id, '1'])),
  };
}

/** 1250 -> "12.5", 5000 -> "50", 1 -> "0.01". */
export function basisPointsToText(bp: number): string {
  const whole = Math.floor(bp / 100);
  const fraction = bp % 100;
  if (fraction === 0) return String(whole);
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`;
}

const paiseText = (paise: number) => (paise > 0 ? paiseToInputString(paise) : '');

/** Rebuild form state from a saved expense so it can be edited exactly as entered. */
export function formStateFromExpense(
  detail: Pick<ExpenseDetail, 'expense' | 'payers' | 'shares'>,
  memberIds: readonly string[],
  selfMemberId: string,
): ExpenseFormState {
  const { expense, payers, shares } = detail;
  const state: ExpenseFormState = {
    ...initialFormState(memberIds, selfMemberId, expense.expenseDate),
    description: expense.description,
    amountText: paiseToInputString(expense.amountPaise),
    category: expense.category,
    categoryLabel: expense.category === 'other' ? (expense.categoryLabel ?? '') : '',
  };

  const firstPayer = payers[0];
  if (payers.length === 1 && firstPayer) {
    state.singlePayerId = firstPayer.memberId;
  } else {
    state.payerMode = 'multiple';
    state.payerAmounts = Object.fromEntries(payers.map((p) => [p.memberId, paiseText(p.amountPaise)]));
  }

  const split = expense.splitInput;
  switch (split.type) {
    case 'equal':
      state.equalMemberIds = [...split.memberIds];
      break;
    case 'exact':
      state.splitMode = 'exact';
      state.exactAmounts = Object.fromEntries(split.entries.map((e) => [e.memberId, paiseText(e.value)]));
      break;
    case 'percentage':
      state.splitMode = 'percentage';
      state.percentages = Object.fromEntries(
        split.entries.map((e) => [e.memberId, e.value > 0 ? basisPointsToText(e.value) : '']),
      );
      break;
    case 'shares':
      state.splitMode = 'shares';
      state.shares = Object.fromEntries(
        split.entries.map((e) => [e.memberId, e.value > 0 ? String(e.value) : '']),
      );
      break;
    case 'itemized':
      // Until the receipt-items editor exists (Phase 5), edit itemized expenses as amounts.
      state.splitMode = 'exact';
      state.exactAmounts = Object.fromEntries(shares.map((s) => [s.memberId, paiseText(s.amountPaise)]));
      break;
  }
  return state;
}

/** Restrict live text input for per-member split fields. Returns `previous` if invalid. */
export function sanitizeSplitInput(
  mode: Exclude<SplitMode, 'equal'>,
  next: string,
  previous: string,
): string {
  switch (mode) {
    case 'exact':
      return sanitizeAmountInput(next, previous);
    case 'percentage':
      return /^\d{0,3}(\.\d{0,2})?$/.test(next) ? next : previous;
    case 'shares':
      return /^\d{0,6}$/.test(next) ? next : previous;
  }
}

/** Blank means 0. Returns null if the text is not a valid value. */
function parseOptionalPaise(text: string | undefined): number | null {
  if (!text || text.trim() === '') return 0;
  const result = parseRupeesToPaise(text);
  if (result.ok) return result.paise;
  return result.error === 'ZERO' ? 0 : null;
}

function parseOptionalPercent(text: string | undefined): number | null {
  if (!text || text.trim() === '') return 0;
  return parsePercentToBasisPoints(text);
}

function parseOptionalShares(text: string | undefined): number | null {
  if (!text || text.trim() === '') return 0;
  return /^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : null;
}

function toEntries(
  memberIds: readonly string[],
  values: ValueMap,
  parse: (text: string | undefined) => number | null,
): WeightedEntry[] | null {
  const entries: WeightedEntry[] = [];
  for (const memberId of memberIds) {
    const value = parse(values[memberId]);
    if (value === null) return null;
    entries.push({ memberId, value });
  }
  return entries;
}

const sumValues = (entries: readonly WeightedEntry[]) => entries.reduce((s, e) => s + e.value, 0);

function remainingHint(
  remaining: number,
  format: (n: number) => string,
  underLabel: string,
  overLabel: string,
): string | null {
  if (remaining > 0) return `${format(remaining)} ${underLabel}`;
  if (remaining < 0) return `${format(-remaining)} ${overLabel}`;
  return null;
}

export function analyzeForm(state: ExpenseFormState, memberIds: readonly string[]): FormAnalysis {
  const problems: string[] = [];

  const description = state.description.trim();
  if (description === '') problems.push('Enter a description.');

  const amount = parseRupeesToPaise(state.amountText);
  const totalPaise = amount.ok ? amount.paise : null;
  if (totalPaise === null) {
    problems.push(
      state.amountText.trim() === ''
        ? 'Enter an amount.'
        : 'Enter a valid amount (up to ₹1 crore, at most 2 decimals).',
    );
  }

  // --- Split ---
  let splitInput: SplitInput | null = null;
  let splitHint: string | null = null;

  switch (state.splitMode) {
    case 'equal': {
      const selected = memberIds.filter((id) => state.equalMemberIds.includes(id));
      if (selected.length === 0) splitHint = 'Select at least one person.';
      else splitInput = { type: 'equal', memberIds: selected };
      break;
    }
    case 'exact': {
      const entries = toEntries(memberIds, state.exactAmounts, parseOptionalPaise);
      if (!entries) {
        splitHint = 'Some amounts aren’t valid.';
      } else {
        splitInput = { type: 'exact', entries };
        if (totalPaise !== null) {
          splitHint = remainingHint(
            totalPaise - sumValues(entries),
            formatPaise,
            'left to assign',
            'over the total',
          );
        }
      }
      break;
    }
    case 'percentage': {
      const entries = toEntries(memberIds, state.percentages, parseOptionalPercent);
      if (!entries) {
        splitHint = 'Some percentages aren’t valid.';
      } else {
        splitInput = { type: 'percentage', entries };
        splitHint = remainingHint(
          BASIS_POINTS_TOTAL - sumValues(entries),
          (bp) => `${basisPointsToText(bp)}%`,
          'left',
          'over 100%',
        );
      }
      break;
    }
    case 'shares': {
      const entries = toEntries(memberIds, state.shares, parseOptionalShares);
      if (!entries) splitHint = 'Shares must be whole numbers.';
      else if (sumValues(entries) === 0) splitHint = 'Give at least one person a share.';
      else splitInput = { type: 'shares', entries };
      break;
    }
  }

  const preview = new Map<string, Paise>();
  let previewIsEstimate = false;
  let splitValid = false;

  if (totalPaise !== null && splitInput) {
    const split = computeSplit(totalPaise, splitInput);
    if (split.ok) {
      splitValid = true;
      for (const share of split.shares) preview.set(share.memberId, share.amountPaise);
    }
  }

  // While the split doesn't add up yet, still show each row's amount as the user types.
  if (!splitValid && splitInput?.type === 'exact') {
    for (const entry of splitInput.entries) {
      if (entry.value > 0) preview.set(entry.memberId, entry.value);
    }
  } else if (!splitValid && splitInput?.type === 'percentage' && totalPaise !== null) {
    // Exact paise allocation needs the full 100%; until then show rounded estimates.
    for (const entry of splitInput.entries) {
      if (entry.value > 0) {
        preview.set(entry.memberId, Math.round((totalPaise * entry.value) / BASIS_POINTS_TOTAL));
      }
    }
    previewIsEstimate = preview.size > 0;
  }

  if (totalPaise !== null && !splitValid) {
    problems.push(splitHint ? `Fix the split: ${splitHint}` : 'Fix the split.');
  }

  // --- Payers ---
  let payers: PayerLine[] | null = null;
  let payerHint: string | null = null;

  if (state.payerMode === 'single') {
    if (totalPaise !== null) payers = [{ memberId: state.singlePayerId, amountPaise: totalPaise }];
  } else {
    const entries = toEntries(memberIds, state.payerAmounts, parseOptionalPaise);
    if (!entries) {
      payerHint = 'Some paid amounts aren’t valid.';
    } else if (totalPaise !== null) {
      const remaining = totalPaise - sumValues(entries);
      payerHint = remainingHint(remaining, formatPaise, 'still unpaid', 'more than the total');
      if (remaining === 0) {
        payers = entries
          .filter((e) => e.value > 0)
          .map((e) => ({ memberId: e.memberId, amountPaise: e.value }));
      }
    }
  }
  if (totalPaise !== null && !payers) {
    problems.push(payerHint ? `Fix who paid: ${payerHint}` : 'Fix who paid.');
  }

  const label = normalizeCategoryLabel(state.category === 'other' ? state.categoryLabel : null);
  if (!label.ok) problems.push(`Keep the category name under ${MAX_CATEGORY_LABEL_LENGTH} characters.`);

  const draft =
    problems.length === 0 && totalPaise !== null && splitInput && payers && label.ok
      ? {
          description,
          amountPaise: totalPaise,
          expenseDate: state.expenseDate,
          category: state.category,
          categoryLabel: label.label,
          payers,
          splitInput,
        }
      : null;

  return { totalPaise, preview, previewIsEstimate, splitHint, payerHint, problems, draft };
}