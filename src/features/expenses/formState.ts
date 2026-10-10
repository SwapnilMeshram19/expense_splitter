/**
 * Pure logic behind the expense form: parsing inputs, live feedback (remaining amount,
 * remaining %), previews, and building the draft to save. No React here, so it is unit-tested
 * directly. Final previews come from computeSplit, the same function that validates on save.
 *
 * Currencies: everything the user types (total, exact amounts, paid amounts) is in the ENTRY
 * currency. That is the group currency, or the bill's currency for a foreign bill, which also needs
 * a rate. The draft carries the bill as entered plus the converted group-currency total; the
 * repository converts shares and payers with the same domain code the server re-runs.
 */
import { expenseForeign, type ExpenseDetail } from '@/db/repositories/expenses';
import type { ExpenseCategory, StoredSplitInput } from '@/db/schema';
import type { PayerLine } from '@/domain/balances';
import { MAX_CATEGORY_LABEL_LENGTH, normalizeCategoryLabel } from '@/domain/categoryLabel';
import {
  DEFAULT_CURRENCY,
  formatMoney,
  isSupportedCurrency,
  maxAmountLabel,
  maxAmountMinor,
  minorDigits,
  minorToInputString,
  parseAmount,
  sanitizeMoneyInput,
  type CurrencyCode,
} from '@/domain/currency';
import { foreignTotal, parseRate, type ForeignAmount } from '@/domain/fx';
import type { Paise } from '@/domain/money';
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
  /** Currency the bill is entered in. The group currency unless it's a foreign bill. */
  currency: CurrencyCode;
  /** Foreign bills only: group-currency units per 1 unit of `currency`, as typed. */
  rateText: string;
  /**
   * False: use today's suggested rate (from the daily table) and keep following it until saved.
   * True: the user typed a rate (card markup) or it's the locked rate of a saved expense.
   */
  rateEdited: boolean;
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
  /** Group currency. For a foreign bill: the converted total. */
  amountPaise: Paise;
  expenseDate: string;
  category: ExpenseCategory;
  /** Normalised custom name, or null. Always null unless category is 'other'. */
  categoryLabel: string | null;
  /** Entry currency. */
  payers: PayerLine[];
  /** Entry currency. */
  splitInput: StoredSplitInput;
  /** Present only for a foreign bill. */
  foreign?: ForeignAmount;
}

export interface FormAnalysis {
  /** Total in the entry currency. */
  totalPaise: Paise | null;
  /** Currency of totalPaise, the preview and the hints. */
  entryCurrency: CurrencyCode;
  /** Foreign bills: the total in the group currency once amount and rate are valid. */
  convertedTotal: Paise | null;
  /**
   * Amount per member (entry currency) to show next to each row. Exact (what will be saved) once
   * the split is valid; while the user is still typing it shows partial values (see previewIsEstimate).
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
  currency: CurrencyCode = DEFAULT_CURRENCY,
): ExpenseFormState {
  return {
    description: '',
    amountText: '',
    currency,
    rateText: '',
    rateEdited: false,
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

const amountText = (minor: number, currency: CurrencyCode) =>
  minor > 0 ? minorToInputString(minor, currency) : '';

/**
 * Rebuild form state from a saved expense so it can be edited exactly as entered. A foreign bill
 * comes back in its own currency with its locked rate.
 */
export function formStateFromExpense(
  detail: Pick<ExpenseDetail, 'expense' | 'payers' | 'shares'> & {
    originalPayers?: ExpenseDetail['originalPayers'];
  },
  memberIds: readonly string[],
  selfMemberId: string,
  groupCurrency: CurrencyCode = DEFAULT_CURRENCY,
): ExpenseFormState {
  const { expense, shares } = detail;
  const foreign = expenseForeign(expense);
  const currency = foreign ? foreign.currency : groupCurrency;
  const payers = foreign && detail.originalPayers ? detail.originalPayers : detail.payers;

  const state: ExpenseFormState = {
    ...initialFormState(memberIds, selfMemberId, expense.expenseDate, groupCurrency),
    description: expense.description,
    currency,
    // The saved rate is locked: editing the amount or split later keeps it.
    rateText: foreign ? foreign.rate : '',
    rateEdited: foreign !== null,
    amountText: minorToInputString(foreign ? foreign.amountMinor : expense.amountPaise, currency),
    category: expense.category,
    categoryLabel: expense.category === 'other' ? (expense.categoryLabel ?? '') : '',
  };

  const firstPayer = payers[0];
  if (payers.length === 1 && firstPayer) {
    state.singlePayerId = firstPayer.memberId;
  } else {
    state.payerMode = 'multiple';
    state.payerAmounts = Object.fromEntries(
      payers.map((p) => [p.memberId, amountText(p.amountPaise, currency)]),
    );
  }

  const split = expense.splitInput;
  switch (split.type) {
    case 'equal':
      state.equalMemberIds = [...split.memberIds];
      break;
    case 'exact':
      state.splitMode = 'exact';
      state.exactAmounts = Object.fromEntries(
        split.entries.map((e) => [e.memberId, amountText(e.value, currency)]),
      );
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
      // Until the receipt-items editor exists, edit itemized expenses as amounts. Shares are stored
      // in the group currency, so a foreign itemized bill is re-entered in the group currency.
      state.splitMode = 'exact';
      state.currency = groupCurrency;
      state.rateText = '';
      state.rateEdited = false;
      state.amountText = minorToInputString(expense.amountPaise, groupCurrency);
      state.exactAmounts = Object.fromEntries(
        shares.map((s) => [s.memberId, amountText(s.amountPaise, groupCurrency)]),
      );
      if (foreign) {
        state.payerMode = detail.payers.length === 1 ? 'single' : 'multiple';
        state.payerAmounts = Object.fromEntries(
          detail.payers.map((p) => [p.memberId, amountText(p.amountPaise, groupCurrency)]),
        );
      }
      break;
  }
  return state;
}

/**
 * Switch the bill's currency. Typed amounts stay as typed (the user is usually fixing the currency
 * before typing more), but any extra decimals the new currency can't hold are cut. The rate goes
 * back to following today's suggested rate for the new pair.
 */
export function withCurrency(state: ExpenseFormState, currency: CurrencyCode): ExpenseFormState {
  if (currency === state.currency) return state;
  const digits = minorDigits(currency);
  const trim = (text: string) => {
    const [whole = '', fraction] = text.split('.');
    if (fraction === undefined) return text;
    return digits === 0 ? whole : `${whole}.${fraction.slice(0, digits)}`;
  };
  const trimAll = (values: ValueMap) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, trim(v)]));
  return {
    ...state,
    currency,
    rateText: '',
    rateEdited: false,
    amountText: trim(state.amountText),
    exactAmounts: trimAll(state.exactAmounts),
    payerAmounts: trimAll(state.payerAmounts),
  };
}

/** Restrict live text input for per-member split fields. Returns `previous` if invalid. */
export function sanitizeSplitInput(
  mode: Exclude<SplitMode, 'equal'>,
  next: string,
  previous: string,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): string {
  switch (mode) {
    case 'exact':
      return sanitizeMoneyInput(next, previous, currency);
    case 'percentage':
      return /^\d{0,3}(\.\d{0,2})?$/.test(next) ? next : previous;
    case 'shares':
      return /^\d{0,6}$/.test(next) ? next : previous;
  }
}

/** Blank means 0. Returns null if the text is not a valid value. */
function parseOptionalMinor(text: string | undefined, currency: CurrencyCode): number | null {
  if (!text || text.trim() === '') return 0;
  const result = parseAmount(text, currency);
  if (result.ok) return result.minor;
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

function invalidAmountMessage(currency: CurrencyCode): string {
  const digits = minorDigits(currency);
  const decimals = digits === 0 ? 'no decimals' : `at most ${digits} decimals`;
  return `Enter a valid amount (up to ${maxAmountLabel(currency)}, ${decimals}).`;
}

/** The rate the form will save: the typed one, or today's suggestion while untouched. */
export const effectiveRateText = (state: ExpenseFormState, suggestedRate: string | null): string =>
  state.rateEdited ? state.rateText : (suggestedRate ?? '');

export function analyzeForm(
  state: ExpenseFormState,
  memberIds: readonly string[],
  groupCurrency: CurrencyCode = DEFAULT_CURRENCY,
  suggestedRate: string | null = null,
): FormAnalysis {
  const problems: string[] = [];
  const entryCurrency = isSupportedCurrency(state.currency) ? state.currency : groupCurrency;
  const isForeign = entryCurrency !== groupCurrency;
  const money = (minor: number) => formatMoney(minor, entryCurrency);

  const description = state.description.trim();
  if (description === '') problems.push('Enter a description.');

  const amount = parseAmount(state.amountText, entryCurrency);
  const totalPaise = amount.ok ? amount.minor : null;
  if (totalPaise === null) {
    problems.push(
      state.amountText.trim() === '' ? 'Enter an amount.' : invalidAmountMessage(entryCurrency),
    );
  }

  // --- Exchange rate (foreign bills) ---
  let foreign: ForeignAmount | null = null;
  let convertedTotal: Paise | null = null;
  if (isForeign) {
    const rate = parseRate(effectiveRateText(state, suggestedRate));
    if (!rate.ok) {
      problems.push(
        rate.error === 'EMPTY'
          ? `Enter the exchange rate: how much is 1 ${entryCurrency} in ${groupCurrency}?`
          : 'Enter a valid exchange rate.',
      );
    } else if (totalPaise !== null) {
      const candidate = { currency: entryCurrency, amountMinor: totalPaise, rate: rate.rate };
      const converted = foreignTotal(candidate, groupCurrency, isSupportedCurrency);
      if (converted.ok) {
        foreign = candidate;
        convertedTotal = converted.totalMinor;
      } else if (converted.error.code === 'FX_TOTAL_TOO_LARGE') {
        problems.push(
          `That’s more than ${maxAmountLabel(groupCurrency)} in ${groupCurrency}. Split it into smaller expenses.`,
        );
      } else if (converted.error.code === 'FX_TOTAL_ZERO') {
        problems.push(
          `That rounds to ${formatMoney(0, groupCurrency)} in ${groupCurrency}. Check the amount and rate.`,
        );
      } else {
        problems.push('Check the amount and exchange rate.');
      }
    }
  }

  // --- Split ---
  let splitInput: SplitInput | null = null;
  let splitHint: string | null = null;
  const parseMinor = (text: string | undefined) => parseOptionalMinor(text, entryCurrency);

  switch (state.splitMode) {
    case 'equal': {
      const selected = memberIds.filter((id) => state.equalMemberIds.includes(id));
      if (selected.length === 0) splitHint = 'Select at least one person.';
      else splitInput = { type: 'equal', memberIds: selected };
      break;
    }
    case 'exact': {
      const entries = toEntries(memberIds, state.exactAmounts, parseMinor);
      if (!entries) {
        splitHint = 'Some amounts aren’t valid.';
      } else {
        splitInput = { type: 'exact', entries };
        if (totalPaise !== null) {
          splitHint = remainingHint(
            totalPaise - sumValues(entries),
            money,
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
    const split = computeSplit(totalPaise, splitInput, maxAmountMinor(entryCurrency));
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
    // Exact allocation needs the full 100%; until then show rounded estimates.
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
    const entries = toEntries(memberIds, state.payerAmounts, parseMinor);
    if (!entries) {
      payerHint = 'Some paid amounts aren’t valid.';
    } else if (totalPaise !== null) {
      const remaining = totalPaise - sumValues(entries);
      payerHint = remainingHint(remaining, money, 'still unpaid', 'more than the total');
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

  const groupTotal = isForeign ? convertedTotal : totalPaise;
  const draft: DraftParts | null =
    problems.length === 0 && groupTotal !== null && splitInput && payers && label.ok
      ? {
          description,
          amountPaise: groupTotal,
          expenseDate: state.expenseDate,
          category: state.category,
          categoryLabel: label.label,
          payers,
          splitInput,
          ...(foreign ? { foreign } : {}),
        }
      : null;

  return {
    totalPaise,
    entryCurrency,
    convertedTotal,
    preview,
    previewIsEstimate,
    splitHint,
    payerHint,
    problems,
    draft,
  };
}