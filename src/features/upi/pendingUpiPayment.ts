import { eq } from 'drizzle-orm';

import type { RepoContext } from '@/db/context';
import { settings } from '@/db/schema';

/** Local-only (settings table is never synced). One pending payment per device. */
export const PENDING_UPI_KEY = 'pending_upi_payment';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingUpiPayment {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  /** Minor units of the group currency. */
  amountPaise: number;
  startedAt: number;
  /** How it was paid: 'UPI' (default for entries saved by older builds), 'PayPal', 'Pix'… */
  via?: string;
  /** A UPI payment in rupees for a group in another currency: what was sent, and at which rate. */
  inrPaise?: number;
  rate?: string;
}

function isPending(v: unknown): v is PendingUpiPayment {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.groupId === 'string' &&
    typeof p.fromMemberId === 'string' &&
    typeof p.toMemberId === 'string' &&
    Number.isSafeInteger(p.amountPaise) &&
    (p.amountPaise as number) > 0 &&
    typeof p.startedAt === 'number' &&
    (p.via === undefined || typeof p.via === 'string') &&
    (p.inrPaise === undefined || Number.isSafeInteger(p.inrPaise)) &&
    (p.rate === undefined || typeof p.rate === 'string')
  );
}

export function getPendingUpiPayment(ctx: RepoContext): PendingUpiPayment | null {
  const raw = ctx.db.select().from(settings).where(eq(settings.key, PENDING_UPI_KEY)).get()?.value;
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPending(value) || ctx.now() - value.startedAt > MAX_AGE_MS) return null;
    return value;
  } catch {
    return null;
  }
}

export function savePendingUpiPayment(ctx: RepoContext, pending: PendingUpiPayment): void {
  const value = JSON.stringify(pending);
  ctx.db.insert(settings).values({ key: PENDING_UPI_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function clearPendingUpiPayment(ctx: RepoContext): void {
  ctx.db.delete(settings).where(eq(settings.key, PENDING_UPI_KEY)).run();
}