/**
 * Receipt text → items, charges and totals. Pure TypeScript (no React, no native), unit-tested.
 *
 * Works on OCR lines *with positions*: on most Indian bills ML Kit returns the item-name column
 * and the price column as separate blocks, so lines are first regrouped into visual rows by
 * vertical position. Each row's trailing numbers are then read as qty / rate / amount and the
 * row is classified by keywords.
 *
 * Heuristic by nature: the result is a starting point the user reviews, never saved as-is.
 */
import { MAX_AMOUNT_PAISE } from '@/domain/money';

export interface OcrLine {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ParsedItem {
  name: string;
  amountPaise: number;
  quantity: number | null;
}

/** Tax, service charge, round-off (signed), discount (negative). */
export interface ParsedCharge {
  label: string;
  amountPaise: number;
}

export interface ParsedReceipt {
  merchant: string | null;
  items: ParsedItem[];
  charges: ParsedCharge[];
  subtotalPaise: number | null;
  totalPaise: number | null;
}

export const EMPTY_RECEIPT: ParsedReceipt = {
  merchant: null,
  items: [],
  charges: [],
  subtotalPaise: null,
  totalPaise: null,
};

export const MAX_ITEM_NAME_LENGTH = 60;

/** Lines whose vertical centres are within this fraction of the median line height share a row. */
const ROW_TOLERANCE = 0.6;
/** Integers this large without decimals are codes (PIN codes, HSN, bill numbers), not amounts. */
const MIN_CODE_PAISE = 10_000_000; // ₹1,00,000

const HAS_WORD = /[a-z]{2,}/i;
const CURRENCY_ONLY = /^(?:₹|rs\.?|inr)$/i;
const QTY_SEPARATOR = /^[x×*@]$/i;

const SKIP =
  /\b(gstin|gst\s*no|fssai|invoice|inv\s*no|bill\s*no|receipt\s*no|order\s*(no|id)|kot|token|table|tbl|covers?|pax|guests?|date|time|phone|ph|mob|mobile|tel|cashier|captain|steward|waiter|server|thank|thanks|visit|welcome|hsn|sac|card|cash|upi|paid|tender|tendered|change|balance|saved|savings|total\s*qty|total\s*items?|no\s*of\s*items)\b/i;
const SUBTOTAL = /\b(sub\s*-?\s*total|item\s*total|food\s*total|gross\s*(amount|amt|total))\b/i;
const GRAND_TOTAL =
  /\b(grand\s*total|net\s*(amount|amt|total|payable|bill)|total\s*(amount|amt|payable|due|bill)|amount\s*(payable|due)|bill\s*(amount|amt|total)|to\s*pay|payable)\b/i;
const CHARGE =
  /\b(c\s*gst|s\s*gst|i\s*gst|ut\s*gst|gst|vat|cess|tax|taxes|service\s*(charge|chg|tax)|packing|packaging|parcel|delivery|container|round(ed)?\s*(off|ing)?|r\s*\/?\s*off|discount|disc|coupon|promo|tip|tips|convenience|platform\s*fee|surcharge)\b/i;
const DISCOUNT = /\b(discount|disc|coupon|promo)\b/i;
const PLAIN_TOTAL = /\btotal\b/i;
/** Only checked before the first item: address lines often end in a number ("Sector 5"). */
const ADDRESS =
  /\b(road|street|nagar|sector|floor|near|opp|opposite|plot|shop\s*no|lane|marg|chowk|colony|phase|bldg|building|complex|mall|pin|pincode|district)\b/i;
const HEADER_WORDS = /\b(item|items|description|particulars|qty|quantity|rate|price|amount|amt)\b/gi;

const isHeader = (label: string) => (label.match(HEADER_WORDS) ?? []).length >= 2;

function cleanLabel(label: string): string {
  return label
    .replace(/\s+/g, ' ')
    .replace(/^[\s:.\-–|*#]+|[\s:.\-–|*#]+$/g, '')
    .slice(0, MAX_ITEM_NAME_LENGTH)
    .trim();
}

/** Regroup OCR lines into visual rows (top to bottom), each row's text left to right. */
export function groupIntoRows(lines: readonly OcrLine[]): string[] {
  const usable = lines.filter((l) => l.text.trim() !== '' && l.height > 0);
  if (usable.length === 0) return [];
  const heights = usable.map((l) => l.height).sort((a, b) => a - b);
  const tolerance = heights[Math.floor(heights.length / 2)]! * ROW_TOLERANCE;
  const centre = (l: OcrLine) => l.top + l.height / 2;

  const rows: { centre: number; lines: OcrLine[] }[] = [];
  for (const line of [...usable].sort((a, b) => centre(a) - centre(b))) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(centre(line) - last.centre) <= tolerance) {
      last.lines.push(line);
      last.centre = last.lines.reduce((sum, l) => sum + centre(l), 0) / last.lines.length;
    } else {
      rows.push({ centre: centre(line), lines: [line] });
    }
  }
  return rows.map((row) =>
    row.lines
      .sort((a, b) => a.left - b.left)
      .map((l) => l.text.trim())
      .join(' '),
  );
}

/**
 * One money token → signed paise, or null. Accepts ₹ / Rs. / INR prefixes, "250/-",
 * Indian (1,25,000) and western (1,250,000) grouping, a decimal comma ("250,50"),
 * parentheses or a leading minus for negatives, and OCR's "O" in place of "0".
 */
export function parseAmountToken(raw: string): number | null {
  let t = raw.trim().replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/\/-$/, '');
  let sign = 1;
  if (/^\(.*\)$/.test(t)) {
    sign = -1;
    t = t.slice(1, -1);
  }
  if (t.startsWith('-')) {
    sign = -1;
    t = t.slice(1);
  } else if (t.startsWith('+')) {
    t = t.slice(1);
  }
  t = t.replace(/^(?:₹|rs\.?)/i, '');
  if (/^[\dOo.,]+$/.test(t) && /\d/.test(t)) t = t.replace(/[Oo]/g, '0');

  if (/^\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/.test(t) || /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(t)) {
    t = t.replace(/,/g, '');
  } else if (/^\d+,\d{2}$/.test(t)) {
    t = t.replace(',', '.');
  }

  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
  if (!match) return null;
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (paise === 0 || paise > MAX_AMOUNT_PAISE) return null;
  return sign * paise;
}

interface Tail {
  label: string;
  amounts: number[];
  /** Whether each amount was written with decimals ("180.00") — counts like "2" are not. */
  decimals: boolean[];
}

/** Split a row into its text label and the run of numbers at its end. */
function splitTail(row: string): Tail {
  const tokens = row.split(/\s+/).filter(Boolean);
  const amounts: number[] = [];
  const decimals: boolean[] = [];
  let i = tokens.length - 1;
  for (; i >= 0; i--) {
    const token = tokens[i]!;
    if (CURRENCY_ONLY.test(token) || QTY_SEPARATOR.test(token)) continue;
    const qtyX = /^(\d{1,3})[x×]$/i.exec(token); // "2x"
    const value = qtyX ? Number(qtyX[1]) * 100 : parseAmountToken(token);
    const hasDecimals = !qtyX && /[.,]\d{1,2}\)?$/.test(token);
    if (value === null || (!hasDecimals && Math.abs(value) >= MIN_CODE_PAISE)) break;
    amounts.unshift(value);
    decimals.unshift(hasDecimals);
  }
  return { label: tokens.slice(0, i + 1).join(' '), amounts, decimals };
}

function extractQuantity(
  label: string,
  amounts: readonly number[],
  decimals: readonly boolean[],
): { name: string; quantity: number | null } {
  const n = amounts.length;
  const amount = amounts[n - 1]!;
  const isCount = (i: number) =>
    i >= 0 && !decimals[i] && amounts[i]! > 0 && amounts[i]! % 100 === 0 && amounts[i]! <= 9900;

  let quantity: number | null = null;
  if (n >= 3 && isCount(n - 3) && (amounts[n - 3]! / 100) * amounts[n - 2]! === amount) {
    quantity = amounts[n - 3]! / 100; // qty rate amount
  } else if (n >= 2 && isCount(n - 2) && amount % (amounts[n - 2]! / 100) === 0) {
    quantity = amounts[n - 2]! / 100; // qty amount
  } else if (n >= 2 && decimals[n - 2] && amounts[n - 2]! > 0 && amount % amounts[n - 2]! === 0) {
    const ratio = amount / amounts[n - 2]!; // rate amount
    if (ratio <= 99) quantity = ratio;
  }

  let name = label;
  const lead = /^(\d{1,2})\s*[x×]?\s+(.*[a-z]{2,}.*)$/i.exec(label); // "2 Masala Dosa"
  if (lead) {
    name = lead[2]!;
    quantity ??= Number(lead[1]);
  }
  return { name, quantity: quantity !== null && quantity >= 1 ? quantity : null };
}

export function parseReceipt(lines: readonly OcrLine[]): ParsedReceipt {
  let merchant: string | null = null;
  const items: ParsedItem[] = [];
  const charges: ParsedCharge[] = [];
  let subtotal: number | null = null;
  let grandTotal: number | null = null;
  let plainTotal: number | null = null;
  let chargesAfterPlainTotal = false;
  let itemsClosed = false;
  /** Text-only rows just above a number-only row: a wrapped item name. */
  let pending: string[] = [];

  for (const row of groupIntoRows(lines)) {
    const { label, amounts, decimals } = splitTail(row);
    const amount = amounts.length > 0 ? amounts[amounts.length - 1]! : null;
    const wordy = HAS_WORD.test(label);

    if (amount === null) {
      if (!wordy || SKIP.test(label) || isHeader(label)) {
        pending = [];
        continue;
      }
      if (merchant === null && items.length === 0 && !itemsClosed) {
        merchant = cleanLabel(label) || null;
        continue;
      }
      pending = [...pending, label].slice(-2);
      continue;
    }

    if (SKIP.test(label) || (items.length === 0 && ADDRESS.test(label))) {
      pending = [];
      continue;
    }
    const value = Math.abs(amount);
    if (SUBTOTAL.test(label)) {
      subtotal = value;
      itemsClosed = true;
      pending = [];
      continue;
    }
    if (GRAND_TOTAL.test(label)) {
      grandTotal = value; // the last (bottom-most) one wins
      itemsClosed = true;
      pending = [];
      continue;
    }
    if (CHARGE.test(label)) {
      if (items.length > 0) {
        charges.push({
          label: cleanLabel(label) || 'Charges',
          amountPaise: DISCOUNT.test(label) ? -value : amount,
        });
        if (plainTotal !== null && grandTotal === null) chargesAfterPlainTotal = true;
      }
      pending = [];
      continue;
    }
    if (PLAIN_TOTAL.test(label)) {
      plainTotal = value;
      itemsClosed = true;
      pending = [];
      continue;
    }
    if (itemsClosed || amount <= 0) {
      pending = []; // payment / footer lines after the totals
      continue;
    }

    const rawName = wordy ? label : pending.join(' ');
    pending = [];
    if (!HAS_WORD.test(rawName)) continue;
    const { name, quantity } = extractQuantity(rawName, amounts, decimals);
    const cleaned = cleanLabel(name);
    if (cleaned) items.push({ name: cleaned, amountPaise: amount, quantity });
  }

  let totalPaise = grandTotal ?? plainTotal;
  // "Total" followed by tax lines and no grand total: that "Total" was the sub-total.
  if (grandTotal === null && plainTotal !== null && chargesAfterPlainTotal && subtotal === null) {
    subtotal = plainTotal;
    totalPaise = null;
  }

  return { merchant, items, charges, subtotalPaise: subtotal, totalPaise };
}