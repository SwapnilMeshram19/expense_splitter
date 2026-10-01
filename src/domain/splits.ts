/**
 * Split engine. Pure TypeScript with zero dependencies, so it runs unchanged on
 * Hermes (app) and Deno (Supabase Edge Functions).
 *
 * All amounts are integer paise. Rounding uses the largest-remainder method with a
 * deterministic tiebreak: shares always sum exactly to the total, no share is more
 * than 1 paisa away from its exact value, and the result does not depend on input order.
 */
import { MAX_AMOUNT_PAISE, type Paise } from './money';

export type MemberId = string;

export interface ShareLine {
  memberId: MemberId;
  amountPaise: Paise;
}

/** Generic (memberId, integer value) pair: paise, basis points, or share units. */
export interface WeightedEntry {
  memberId: MemberId;
  value: number;
}

export interface ItemInput {
  /** Line total in paise (qty × rate already applied). Must be > 0. */
  amountPaise: Paise;
  /** Members sharing this item equally. */
  memberIds: MemberId[];
}

export type SplitInput =
  | { type: 'equal'; memberIds: MemberId[] }
  /** value = paise owed; must sum exactly to the total. */
  | { type: 'exact'; entries: WeightedEntry[] }
  /** value = basis points (12.5% = 1250); must sum exactly to 10000. */
  | { type: 'percentage'; entries: WeightedEntry[] }
  /** value = positive integer share units (e.g. 2:1:1). */
  | { type: 'shares'; entries: WeightedEntry[] }
  /** Receipt items; total minus item sum (tax, service, discount) is spread proportionally. */
  | { type: 'itemized'; items: ItemInput[] };

export type SplitError =
  | { code: 'INVALID_TOTAL' }
  | { code: 'INVALID_SPLIT_TYPE' }
  | { code: 'NO_PARTICIPANTS' }
  | { code: 'DUPLICATE_MEMBER'; memberId: MemberId }
  | { code: 'INVALID_VALUE'; memberId?: MemberId }
  | { code: 'EXACT_SUM_MISMATCH'; expected: Paise; actual: Paise }
  | { code: 'PERCENT_SUM_MISMATCH'; expected: number; actual: number }
  | { code: 'ITEM_UNASSIGNED'; itemIndex: number }
  | { code: 'ITEM_INVALID'; itemIndex: number };

export type SplitResult = { ok: true; shares: ShareLine[] } | { ok: false; error: SplitError };

export const BASIS_POINTS_TOTAL = 10_000;
/** Upper bound for a single share-unit value; keeps input sane. */
export const MAX_SHARE_UNITS = 1_000_000;

const ok = (shares: ShareLine[]): SplitResult => ({ ok: true, shares });
const fail = (error: SplitError): SplitResult => ({ ok: false, error });

/**
 * Locale-independent ordering (UTF-16 code units). Never use localeCompare here:
 * the app and the server may run with different locales and would then assign
 * the leftover paisa to different members.
 */
export function compareMemberIds(a: MemberId, b: MemberId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Allocate `totalPaise` across entries in proportion to their integer weights
 * using the largest-remainder method. Output preserves input order.
 * Throws on programmer error (invalid arguments); callers validate user input first.
 */
export function allocateByWeights(totalPaise: Paise, weights: readonly WeightedEntry[]): ShareLine[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError(`Invalid total: ${totalPaise}`);
  }

  let weightSum = 0n;
  for (const w of weights) {
    if (!Number.isSafeInteger(w.value) || w.value < 0) {
      throw new RangeError(`Invalid weight for ${w.memberId}: ${w.value}`);
    }
    weightSum += BigInt(w.value);
  }
  if (weightSum === 0n) throw new RangeError('Sum of weights must be positive');

  const total = BigInt(totalPaise);
  const rows = weights.map((w) => {
    const product = total * BigInt(w.value);
    return { memberId: w.memberId, base: product / weightSum, remainder: product % weightSum };
  });

  let leftover = total;
  for (const row of rows) leftover -= row.base;

  const ranked = [...rows].sort((a, b) =>
    a.remainder !== b.remainder
      ? a.remainder > b.remainder
        ? -1
        : 1
      : compareMemberIds(a.memberId, b.memberId),
  );

  // leftover is strictly less than the number of rows with remainder > 0, and those
  // rows sort first, so every leftover paisa lands on a row with a fractional share.
  for (const row of ranked) {
    if (leftover === 0n) break;
    row.base += 1n;
    leftover -= 1n;
  }

  return rows.map((r) => ({ memberId: r.memberId, amountPaise: Number(r.base) }));
}

/** Validate user-provided entries: non-empty, unique ids, non-negative integers, at least one > 0. */
function validateEntries(entries: readonly WeightedEntry[], maxValue: number): SplitError | null {
  if (entries.length === 0) return { code: 'NO_PARTICIPANTS' };

  const seen = new Set<MemberId>();
  let anyPositive = false;

  for (const e of entries) {
    if (!e.memberId) return { code: 'INVALID_VALUE' };
    if (seen.has(e.memberId)) return { code: 'DUPLICATE_MEMBER', memberId: e.memberId };
    seen.add(e.memberId);

    if (!Number.isSafeInteger(e.value) || e.value < 0 || e.value > maxValue) {
      return { code: 'INVALID_VALUE', memberId: e.memberId };
    }
    if (e.value > 0) anyPositive = true;
  }

  return anyPositive ? null : { code: 'NO_PARTICIPANTS' };
}

const positiveOnly = (entries: readonly WeightedEntry[]) => entries.filter((e) => e.value > 0);

function splitEqual(totalPaise: Paise, memberIds: readonly MemberId[]): SplitResult {
  const entries = memberIds.map((memberId) => ({ memberId, value: 1 }));
  const error = validateEntries(entries, 1);
  if (error) return fail(error);
  return ok(allocateByWeights(totalPaise, entries));
}

function splitExact(totalPaise: Paise, entries: readonly WeightedEntry[]): SplitResult {
  const error = validateEntries(entries, MAX_AMOUNT_PAISE);
  if (error) return fail(error);

  const actual = entries.reduce((sum, e) => sum + e.value, 0);
  if (actual !== totalPaise) {
    return fail({ code: 'EXACT_SUM_MISMATCH', expected: totalPaise, actual });
  }
  return ok(positiveOnly(entries).map((e) => ({ memberId: e.memberId, amountPaise: e.value })));
}

function splitPercentage(totalPaise: Paise, entries: readonly WeightedEntry[]): SplitResult {
  const error = validateEntries(entries, BASIS_POINTS_TOTAL);
  if (error) return fail(error);

  const actual = entries.reduce((sum, e) => sum + e.value, 0);
  if (actual !== BASIS_POINTS_TOTAL) {
    return fail({ code: 'PERCENT_SUM_MISMATCH', expected: BASIS_POINTS_TOTAL, actual });
  }
  return ok(allocateByWeights(totalPaise, positiveOnly(entries)));
}

function splitShares(totalPaise: Paise, entries: readonly WeightedEntry[]): SplitResult {
  const error = validateEntries(entries, MAX_SHARE_UNITS);
  if (error) return fail(error);
  return ok(allocateByWeights(totalPaise, positiveOnly(entries)));
}

function splitItemized(totalPaise: Paise, items: readonly ItemInput[]): SplitResult {
  if (items.length === 0) return fail({ code: 'NO_PARTICIPANTS' });

  // Stage 1: each item split equally among its assignees -> per-member subtotal.
  const subtotals = new Map<MemberId, number>();

  for (const [itemIndex, item] of items.entries()) {
    const { amountPaise, memberIds } = item;
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > MAX_AMOUNT_PAISE) {
      return fail({ code: 'ITEM_INVALID', itemIndex });
    }
    if (memberIds.length === 0) return fail({ code: 'ITEM_UNASSIGNED', itemIndex });
    if (memberIds.some((id) => !id) || new Set(memberIds).size !== memberIds.length) {
      return fail({ code: 'ITEM_INVALID', itemIndex });
    }

    const parts = allocateByWeights(
      amountPaise,
      memberIds.map((memberId) => ({ memberId, value: 1 })),
    );
    for (const part of parts) {
      subtotals.set(part.memberId, (subtotals.get(part.memberId) ?? 0) + part.amountPaise);
    }
  }

  // Stage 2: allocate the receipt total proportionally to subtotals, which spreads
  // tax / service charge / discount / round-off without special cases.
  const weights = [...subtotals].map(([memberId, value]) => ({ memberId, value }));
  return ok(allocateByWeights(totalPaise, weights));
}

/**
 * Compile-time exhaustiveness check (adding a SplitInput variant without a case fails to
 * compile). At runtime, rejects malformed input such as tampered JSON on the server.
 */
function rejectUnknownType(input: never): SplitResult {
  void input;
  return fail({ code: 'INVALID_SPLIT_TYPE' });
}

/** Compute who owes what for an expense of `totalPaise`. Never throws for user input. */
export function computeSplit(totalPaise: Paise, input: SplitInput): SplitResult {
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > MAX_AMOUNT_PAISE) {
    return fail({ code: 'INVALID_TOTAL' });
  }

  switch (input.type) {
    case 'equal':
      return splitEqual(totalPaise, input.memberIds);
    case 'exact':
      return splitExact(totalPaise, input.entries);
    case 'percentage':
      return splitPercentage(totalPaise, input.entries);
    case 'shares':
      return splitShares(totalPaise, input.entries);
    case 'itemized':
      return splitItemized(totalPaise, input.items);
    default:
      return rejectUnknownType(input);
  }
}

/** Sum of item lines; the UI compares this against the receipt total to warn about missed items. */
export function itemsSubtotal(items: readonly ItemInput[]): Paise {
  return items.reduce((sum, item) => sum + item.amountPaise, 0);
}

/** Parse "12.5", "33.33", "50%" into basis points (1250, 3333, 5000). Returns null if invalid. */
export function parsePercentToBasisPoints(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(input.replace(/[%\s]/g, ''));
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const basisPoints = whole * 100 + fraction;
  return basisPoints <= BASIS_POINTS_TOTAL ? basisPoints : null;
}