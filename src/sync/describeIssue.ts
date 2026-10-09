import { formatPaise } from '@/domain/money';
import { maskVpa } from '@/domain/upi';

import type { WireTable } from './wire';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : 0);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** '2026-10-01' → '1 Oct 2026' (no Intl: identical on every Android version). */
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ''} ${match[1]}`;
}

function lines(value: unknown): { memberId: string; amount: number }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((l) => ({ memberId: str(l.member_id), amount: num(l.amount_paise) }));
}

export function issueTitle(table: WireTable, row: Record<string, unknown> | null): string {
  switch (table) {
    case 'groups':
      return `Group “${str(row?.name)}”`;
    case 'members':
      return `Member “${str(row?.display_name)}”`;
    case 'expenses':
      return `Expense “${str(row?.description)}”`;
    case 'settlements':
      return 'Payment';
    case 'activity':
      return 'History entry';
  }
}

/** Human-readable lines describing one version of a row. */
export function summarizeRow(
  table: WireTable,
  row: Record<string, unknown> | null,
  nameOf: (memberId: string) => string,
): string[] {
  if (!row) return ['Not on this phone'];

  const out: string[] = [];
  if (row.deleted_at !== null && row.deleted_at !== undefined) out.push('Deleted');

  switch (table) {
    case 'groups':
      out.push(`Name: ${str(row.name)}`);
      break;
    case 'members': {
      out.push(`Name: ${str(row.display_name)}`);
      const vpa = str(row.upi_vpa);
      out.push(`UPI ID: ${vpa ? maskVpa(vpa) : 'none'}`);
      break;
    }
    case 'expenses': {
      out.push(`${str(row.description)} · ${formatPaise(num(row.amount_paise))}`);
      out.push(`Date: ${formatIsoDate(str(row.expense_date))}`);
      const payers = lines(row.payers);
      const shares = lines(row.shares);
      if (payers.length > 0) {
        out.push(`Paid by ${payers.map((p) => `${nameOf(p.memberId)} ${formatPaise(p.amount)}`).join(', ')}`);
      }
      if (shares.length > 0) {
        out.push(`Split: ${shares.map((s) => `${nameOf(s.memberId)} ${formatPaise(s.amount)}`).join(', ')}`);
      }
      break;
    }
    case 'settlements':
      out.push(
        `${nameOf(str(row.from_member_id))} paid ${nameOf(str(row.to_member_id))} ${formatPaise(num(row.amount_paise))}`,
      );
      break;
    case 'activity':
      out.push('History entry');
      break;
  }
  return out;
}

/**
 * Why the server refused a change, in terms a user can act on.
 * `detail` is the Postgres SQLSTATE for INVALID rejections.
 */
export function rejectionReason(code: string | undefined, detail?: string): string {
  // Raised by private.guard_member_vpa(): the placeholder was claimed while this phone edited it.
  if (detail === '23V01') return 'This person has joined the group, so only they can change their UPI ID.';
  switch (code) {
    case 'FORBIDDEN':
    case 'NOT_A_MEMBER':
      return 'You don’t have access to this group any more.';
    case 'USER_ID_NOT_ALLOWED':
    case 'USER_ID_IMMUTABLE':
      return 'People can only be linked to accounts through an invite.';
    case 'UNKNOWN_MEMBER':
      return 'It refers to someone who isn’t in this group.';
    case 'INVALID_EXPENSE':
      return 'The amounts or the split don’t add up.';
    case 'SHARES_MISMATCH':
      return 'This version of the app calculated the split differently. Please update the app.';
    case 'MEMBER_HAS_BALANCE':
      return 'This person still owes or is owed money in the group, so they weren’t removed. Settle up first.';
    case 'GROUP_HAS_BALANCES':
      return 'Some balances in this group aren’t settled yet, so it wasn’t deleted. Settle up first.';
    default:
      return 'The server couldn’t accept this change.';
  }
}