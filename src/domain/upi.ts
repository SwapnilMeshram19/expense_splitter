/**
 * UPI helpers: UPI ID (VPA) validation and upi://pay deep links (NPCI linking spec, P2P subset).
 *
 * Pure and dependency-free, like the rest of src/domain, so the Edge Function can share it.
 * Keep VPA_PATTERN identical to members_upi_vpa_check (supabase/migrations/*_upi_vpa.sql).
 */

export const MAX_VPA_LENGTH = 255;

/**
 * Lowercase `handle@psp`. The allowed characters are all URI-safe, which matters: some UPI apps
 * fail to decode `%40`, so `pa` is put into the link unencoded.
 */
export const VPA_PATTERN = /^[a-z0-9][a-z0-9._-]*@[a-z][a-z0-9]+$/;

/**
 * Default NPCI per-transaction cap for P2P (₹1,00,000). Banks and apps may apply lower limits,
 * e.g. ₹5,000 during a new UPI user's first 24 hours, so a payment under this can still be declined.
 */
export const UPI_P2P_LIMIT_PAISE = 10_000_000;

export const MAX_UPI_NAME_LENGTH = 40;
export const MAX_UPI_NOTE_LENGTH = 50;

/** UPI transaction reference (UTR / RRN) shown on success screens and bank SMS. */
export const UTR_PATTERN = /^\d{12}$/;

export type VpaError =
  | { code: 'VPA_REQUIRED' }
  | { code: 'VPA_TOO_LONG'; max: number }
  | { code: 'VPA_INVALID' };

export type VpaParse = { ok: true; vpa: string } | { ok: false; error: VpaError };

const INVALID: VpaParse = { ok: false, error: { code: 'VPA_INVALID' } };

/** `pa` from a pasted upi://pay?... link (what a UPI QR code contains). */
function payeeFromUpiUri(text: string): string | null {
  const q = text.indexOf('?');
  if (q < 0) return null;
  for (const pair of text.slice(q + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0 || pair.slice(0, eq).toLowerCase() !== 'pa') continue;
    try {
      return decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    } catch {
      return null;
    }
  }
  return null;
}

/** Accepts a typed UPI ID or a pasted upi:// link; returns the normalized (lowercase) UPI ID. */
export function parseVpaInput(raw: string): VpaParse {
  let text = raw.trim();
  if (/^upi:\/\//i.test(text)) {
    const fromUri = payeeFromUpiUri(text);
    if (fromUri === null) return INVALID;
    text = fromUri;
  }
  const vpa = text.replace(/\s+/g, '').toLowerCase();
  if (vpa === '') return { ok: false, error: { code: 'VPA_REQUIRED' } };
  if (vpa.length > MAX_VPA_LENGTH) return { ok: false, error: { code: 'VPA_TOO_LONG', max: MAX_VPA_LENGTH } };
  if (!VPA_PATTERN.test(vpa)) return INVALID;
  return { ok: true, vpa };
}

/** For stored/synced values, which are untrusted input (another member's phone wrote them). */
export function isValidVpa(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_VPA_LENGTH && VPA_PATTERN.test(value);
}

/** `9876543210@ybl` → `98•••@ybl`. For logs and anywhere the full ID isn't needed. */
export function maskVpa(vpa: string): string {
  const at = vpa.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = vpa.slice(0, at);
  return `${local.slice(0, local.length > 4 ? 2 : 1)}•••${vpa.slice(at)}`;
}

/** Integer paise → exact 2-decimal rupees string, no floating point: 30050 → "300.50". */
export function paiseToUpiAmount(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new RangeError(`Invalid UPI amount: ${paise}`);
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/**
 * Some UPI apps reject or mangle non-ASCII / special characters in pn/tn, so keep a safe subset.
 * Names in other scripts end up empty and the parameter is omitted; the UPI app then shows the
 * bank-registered name anyway.
 */
export function sanitizeUpiText(text: string, maxLength: number): string {
  return text
    .replace(/[^A-Za-z0-9 .,-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export interface UpiPayRequest {
  payeeVpa: string;
  payeeName: string;
  amountPaise: number;
  note?: string;
}

/**
 * P2P link: pa, pn, am, cu, tn only. No tr/tid/mc/sign: those are for merchants, and sending
 * fake ones makes apps decline. Throws on an invalid VPA (prevents parameter injection via a
 * synced value like "x@ybl&am=1").
 */
export function buildUpiPayUri(req: UpiPayRequest): string {
  if (!isValidVpa(req.payeeVpa)) throw new Error('Invalid payee UPI ID');
  const params = [`pa=${req.payeeVpa}`];
  const pn = sanitizeUpiText(req.payeeName, MAX_UPI_NAME_LENGTH);
  if (pn) params.push(`pn=${encodeURIComponent(pn)}`);
  params.push(`am=${paiseToUpiAmount(req.amountPaise)}`, 'cu=INR');
  const tn = sanitizeUpiText(req.note ?? '', MAX_UPI_NOTE_LENGTH);
  if (tn) params.push(`tn=${encodeURIComponent(tn)}`);
  return `upi://pay?${params.join('&')}`;
}