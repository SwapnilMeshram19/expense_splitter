import { isSupportedCurrency } from '../_shared/domain/currency.ts';
import { validateExpense } from '../_shared/domain/expenseValidation.ts';
import type { ForeignAmount } from '../_shared/domain/fx.ts';
import { isCanonicalNote, isReceiptId } from '../_shared/domain/note.ts';
import type { SplitInput } from '../_shared/domain/splits.ts';

export const TABLES = ['groups', 'members', 'expenses', 'settlements', 'activity'] as const;
export type Table = (typeof TABLES)[number];
export type Row = Record<string, unknown>;
export type Batch = Record<Table, Row[]>;
export interface Rejection {
  table: Table;
  id: string;
  code: string;
  detail?: string;
}

export const MAX_ROWS = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export type ParseResult = { ok: true; batch: Batch } | { ok: false; error: string };

/** Shape checks only. Types of individual fields are enforced by SQL casts and constraints. */
export function parseBatch(body: unknown): ParseResult {
  if (!isObject(body)) return { ok: false, error: 'INVALID_BATCH' };

  const batch: Batch = { groups: [], members: [], expenses: [], settlements: [], activity: [] };
  let total = 0;

  for (const table of TABLES) {
    const rows = body[table] ?? [];
    if (!Array.isArray(rows)) return { ok: false, error: `INVALID_TABLE:${table}` };

    const seen = new Set<string>();
    for (const row of rows) {
      if (!isObject(row)) return { ok: false, error: `INVALID_ROW:${table}` };
      const id = row.id;
      if (!isUuid(id)) return { ok: false, error: `INVALID_ROW:${table}` };
      if (table !== 'groups' && !isUuid(row.group_id)) return { ok: false, error: `INVALID_ROW:${table}` };
      if (table !== 'activity') {
        const base = row.base_version;
        if (typeof base !== 'number' || !Number.isInteger(base) || base < 0) {
          return { ok: false, error: `INVALID_ROW:${table}` };
        }
      }
      const key = id.toLowerCase();
      if (seen.has(key)) return { ok: false, error: `DUPLICATE_ROW:${table}` };
      seen.add(key);
    }

    total += rows.length;
    batch[table] = rows as Row[];
  }

  if (total === 0) return { ok: false, error: 'EMPTY_BATCH' };
  if (total > MAX_ROWS) return { ok: false, error: 'TOO_MANY_ROWS' };
  return { ok: true, batch };
}

interface Line {
  member_id: string;
  amount_paise: number;
  /** Payer lines of foreign bills: the amount in the bill's currency. */
  original_amount_minor?: number;
}

function asLines(value: unknown): Line[] | null {
  if (!Array.isArray(value)) return null;
  const lines: Line[] = [];
  for (const item of value) {
    if (!isObject(item)) return null;
    const memberId = item.member_id;
    const amount = item.amount_paise;
    const original = item.original_amount_minor;
    if (!isUuid(memberId) || typeof amount !== 'number') return null;
    if (original !== undefined && original !== null && typeof original !== 'number') return null;
    lines.push(
      typeof original === 'number'
        ? { member_id: memberId.toLowerCase(), amount_paise: amount, original_amount_minor: original }
        : { member_id: memberId.toLowerCase(), amount_paise: amount },
    );
  }
  return lines;
}

/**
 * The bill part of an expense row: null for a group-currency expense, 'INVALID' when the three
 * fields are only partly there or mistyped.
 */
function asForeign(row: Row): ForeignAmount | null | 'INVALID' {
  const { original_currency: currency, original_amount_minor: amountMinor, fx_rate: rate } = row;
  if (currency == null && amountMinor == null && rate == null) return null;
  if (typeof currency !== 'string' || typeof amountMinor !== 'number' || typeof rate !== 'string') return 'INVALID';
  return { currency, amountMinor, rate };
}

/** Group rows may carry a currency; the database checks the format, this checks it's one we support. */
export function checkGroups(batch: Batch): { batch: Batch; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const groups = batch.groups.filter((row) => {
    if (row.currency === undefined || isSupportedCurrency(row.currency)) return true;
    rejected.push({ table: 'groups', id: String(row.id), code: 'INVALID_GROUP', detail: 'UNKNOWN_CURRENCY' });
    return false;
  });
  return { batch: { ...batch, groups }, rejected };
}

const lineKey = (lines: { memberId: string; amountPaise: number }[]) =>
  lines
    .map((l) => `${l.memberId.toLowerCase()}:${l.amountPaise}`)
    .sort()
    .join('|');

// Membership is enforced in SQL (apply_push) against the database. Here we check only the math,
// so every member id is accepted at this layer.
const ANY_MEMBER = { has: () => true } as unknown as ReadonlySet<string>;

/**
 * Re-validates every expense with the app's own domain code. The server stores the shares it
 * computes, and rejects the row if the client's shares differ (tampering or version skew).
 * History entries for rejected expenses are dropped so the log never describes a missing row.
 *
 * Currencies: `group_currency` says which currency the amounts are in (rows without it come from
 * builds before multi-currency: INR). Whether it matches the group is checked in SQL, against the
 * database. A foreign bill is re-split in its own currency and re-converted at its locked rate;
 * both shares and payers must come out exactly as the phone computed them.
 */
export function checkExpenses(batch: Batch): { batch: Batch; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const accepted: Row[] = [];

  for (const row of batch.expenses) {
    const id = String(row.id);
    const reject = (code: string, detail?: string) =>
      rejected.push(detail ? { table: 'expenses', id, code, detail } : { table: 'expenses', id, code });

    const payers = asLines(row.payers);
    const shares = asLines(row.shares);
    if (!payers || !shares || typeof row.amount_paise !== 'number') {
      reject('INVALID_EXPENSE', 'SHAPE');
      continue;
    }

    const currency = row.group_currency === undefined ? 'INR' : row.group_currency;
    if (!isSupportedCurrency(currency)) {
      reject('INVALID_EXPENSE', 'UNKNOWN_CURRENCY');
      continue;
    }
    // Notes and receipts: optional keys (older builds don't send them, and the row keeps its values).
    if ('note' in row && !isCanonicalNote(row.note)) {
      reject('INVALID_EXPENSE', 'NOTE');
      continue;
    }
    if ('receipt_id' in row && row.receipt_id !== null && !isReceiptId(row.receipt_id)) {
      reject('INVALID_EXPENSE', 'RECEIPT');
      continue;
    }

    const foreign = asForeign(row);
    if (foreign === 'INVALID' || (foreign && payers.some((p) => p.original_amount_minor === undefined))) {
      reject('INVALID_EXPENSE', 'FX_SHAPE');
      continue;
    }

    let result: ReturnType<typeof validateExpense>;
    try {
      result = validateExpense(
        {
          description: typeof row.description === 'string' ? row.description : '',
          amountPaise: row.amount_paise,
          expenseDate: typeof row.expense_date === 'string' ? row.expense_date : '',
          // Validated in the currency the bill was entered in.
          payers: payers.map((p) => ({
            memberId: p.member_id,
            amountPaise: foreign ? (p.original_amount_minor ?? 0) : p.amount_paise,
          })),
          splitInput: row.split_input as SplitInput,
          currency,
          foreign,
        },
        ANY_MEMBER,
      );
    } catch {
      reject('INVALID_EXPENSE', 'SPLIT_INPUT');
      continue;
    }

    if (!result.ok) {
      reject('INVALID_EXPENSE', result.error.code);
      continue;
    }

    const clientShares = shares.map((s) => ({ memberId: s.member_id, amountPaise: s.amount_paise }));
    if (lineKey(result.shares) !== lineKey(clientShares)) {
      reject('SHARES_MISMATCH');
      continue;
    }
    const clientPayers = payers
      .filter((p) => p.amount_paise > 0 || (p.original_amount_minor ?? 0) > 0)
      .map((p) => ({ memberId: p.member_id, amountPaise: p.amount_paise }));
    if (foreign && lineKey(result.payers) !== lineKey(clientPayers)) {
      reject('PAYERS_MISMATCH');
      continue;
    }

    const original = new Map(result.originalPayers?.map((p) => [p.memberId, p.amountPaise]));
    accepted.push({
      ...row,
      description: result.description,
      payers: result.payers.map((p) =>
        result.originalPayers
          ? { member_id: p.memberId, amount_paise: p.amountPaise, original_amount_minor: original.get(p.memberId) }
          : { member_id: p.memberId, amount_paise: p.amountPaise },
      ),
      shares: result.shares.map((s) => ({ member_id: s.memberId, amount_paise: s.amountPaise })),
    });
  }

  const rejectedIds = new Set(rejected.map((r) => r.id.toLowerCase()));
  const activity = batch.activity.filter((a) => !rejectedIds.has(String(a.entity_id).toLowerCase()));

  return { batch: { ...batch, expenses: accepted, activity }, rejected };
}