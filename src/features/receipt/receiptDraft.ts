/**
 * The bill being reviewed after a scan: editable items, who had what, and the bill total.
 * Kept in the local-only settings table so it survives the app being killed in the background
 * (common on low-end phones while the camera is open). One draft per device; never synced.
 */
import { eq } from 'drizzle-orm';

import type { RepoContext } from '@/db/context';
import { settings, type StoredSplitInput } from '@/db/schema';
import { MAX_DESCRIPTION_LENGTH } from '@/domain/expenseValidation';
import { paiseToInputString, parseRupeesToPaise } from '@/domain/money';
import { computeSplit, type ItemInput } from '@/domain/splits';

import { MAX_ITEM_NAME_LENGTH, type ParsedReceipt } from './parseReceipt';

export const RECEIPT_DRAFT_KEY = 'receipt_draft';
export const MAX_RECEIPT_ITEMS = 60;
/** Parsed tax/charges "explain" the gap between items and total when within ₹1 (rounding). */
const EXPLAINED_TOLERANCE_PAISE = 100;

export interface DraftItem {
  id: string;
  name: string;
  /** Kept as typed text (like the expense form) so partial input like "12." survives. */
  amountText: string;
  quantity: number | null;
  memberIds: string[];
}

export interface ReceiptDraft {
  v: 1;
  groupId: string;
  description: string;
  items: DraftItem[];
  totalText: string;
  /** Sum of parsed tax/charges/discounts, used to explain total − items. null if none were found. */
  parsedChargesPaise: number | null;
  createdAt: number;
}

export const blankItem = (id: string): DraftItem => ({ id, name: '', amountText: '', quantity: null, memberIds: [] });

export function draftFromParsed(
  parsed: ParsedReceipt,
  groupId: string,
  newId: () => string,
  now: number,
): ReceiptDraft {
  const itemsSum = parsed.items.reduce((sum, i) => sum + i.amountPaise, 0);
  const chargesSum = parsed.charges.reduce((sum, c) => sum + c.amountPaise, 0);
  const total =
    parsed.totalPaise ?? (parsed.items.length > 0 ? (parsed.subtotalPaise ?? itemsSum) + chargesSum : null);

  const items: DraftItem[] = parsed.items.slice(0, MAX_RECEIPT_ITEMS).map((i) => ({
    id: newId(),
    name: i.name.slice(0, MAX_ITEM_NAME_LENGTH),
    amountText: paiseToInputString(i.amountPaise),
    quantity: i.quantity,
    memberIds: [],
  }));

  return {
    v: 1,
    groupId,
    description: (parsed.merchant ?? 'Bill').slice(0, MAX_DESCRIPTION_LENGTH),
    items: items.length > 0 ? items : [blankItem(newId())],
    totalText: total !== null && total > 0 ? paiseToInputString(total) : '',
    parsedChargesPaise: parsed.charges.length > 0 ? chargesSum : null,
    createdAt: now,
  };
}

export interface ReceiptAnalysis {
  totalPaise: number | null;
  itemsSubtotalPaise: number;
  /** total − items: positive = tax/charges (or a missed item), negative = discount. */
  differencePaise: number | null;
  differenceExplained: boolean;
  unassignedCount: number;
  /** What each member will owe, once the draft is valid. */
  preview: Map<string, number>;
  problems: string[];
  splitInput: StoredSplitInput | null;
}

export function analyzeReceiptDraft(draft: ReceiptDraft): ReceiptAnalysis {
  const problems: string[] = [];
  const items: (ItemInput & { name: string })[] = [];
  let unassignedCount = 0;

  draft.items.forEach((item, index) => {
    const name = item.name.trim();
    const amountText = item.amountText.trim();
    if (name === '' && amountText === '') return; // untouched blank row
    const amount = parseRupeesToPaise(amountText);
    if (!amount.ok) {
      problems.push(`Check the amount of “${name || `item ${index + 1}`}”.`);
      return;
    }
    if (item.memberIds.length === 0) unassignedCount += 1;
    items.push({
      name: (name || `Item ${index + 1}`).slice(0, MAX_ITEM_NAME_LENGTH),
      amountPaise: amount.paise,
      memberIds: [...item.memberIds],
    });
  });

  const itemsSubtotalPaise = items.reduce((sum, i) => sum + i.amountPaise, 0);
  const total = parseRupeesToPaise(draft.totalText.trim());
  const totalPaise = total.ok ? total.paise : null;
  const differencePaise = totalPaise !== null && items.length > 0 ? totalPaise - itemsSubtotalPaise : null;
  const differenceExplained =
    differencePaise !== null &&
    draft.parsedChargesPaise !== null &&
    Math.abs(differencePaise - draft.parsedChargesPaise) <= EXPLAINED_TOLERANCE_PAISE;

  if (items.length === 0 && problems.length === 0) problems.push('Add at least one item.');
  if (unassignedCount > 0) {
    problems.push(`Choose who had ${unassignedCount === 1 ? '1 item' : `${unassignedCount} items`}.`);
  }
  if (totalPaise === null) problems.push('Enter the bill total.');
  if (draft.description.trim() === '') problems.push('Add a description.');

  const preview = new Map<string, number>();
  let splitInput: StoredSplitInput | null = null;
  if (problems.length === 0 && totalPaise !== null) {
    const result = computeSplit(totalPaise, { type: 'itemized', items });
    if (result.ok) {
      for (const share of result.shares) preview.set(share.memberId, share.amountPaise);
      splitInput = { type: 'itemized', items };
    } else {
      problems.push('Check the items and the total.');
    }
  }

  return {
    totalPaise,
    itemsSubtotalPaise,
    differencePaise,
    differenceExplained,
    unassignedCount,
    preview,
    problems,
    splitInput,
  };
}

// ── Storage ────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function isDraftItem(v: unknown): v is DraftItem {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.amountText === 'string' &&
    (v.quantity === null || typeof v.quantity === 'number') &&
    Array.isArray(v.memberIds) &&
    v.memberIds.every((m) => typeof m === 'string')
  );
}

function isDraft(v: unknown): v is ReceiptDraft {
  return (
    isRecord(v) &&
    v.v === 1 &&
    typeof v.groupId === 'string' &&
    typeof v.description === 'string' &&
    typeof v.totalText === 'string' &&
    (v.parsedChargesPaise === null || typeof v.parsedChargesPaise === 'number') &&
    typeof v.createdAt === 'number' &&
    Array.isArray(v.items) &&
    v.items.every(isDraftItem)
  );
}

export function getReceiptDraft(ctx: RepoContext): ReceiptDraft | null {
  const raw = ctx.db.select().from(settings).where(eq(settings.key, RECEIPT_DRAFT_KEY)).get()?.value;
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isDraft(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveReceiptDraft(ctx: RepoContext, draft: ReceiptDraft): void {
  const value = JSON.stringify(draft);
  ctx.db
    .insert(settings)
    .values({ key: RECEIPT_DRAFT_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export function clearReceiptDraft(ctx: RepoContext): void {
  ctx.db.delete(settings).where(eq(settings.key, RECEIPT_DRAFT_KEY)).run();
}