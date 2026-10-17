/**
 * Payment details beyond UPI: how a member can be paid in other countries.
 *
 * The app never moves money. It opens the payer's own app (a payment link) or shows details and
 * QR codes that the payer's banking app understands, then the payment is recorded by hand, the
 * same way UPI works. So everything here is free, and no payment licence is needed.
 *
 * Pure and dependency-free (shared with the Edge Function by scripts/sync-domain.mjs).
 * Stored per member as a JSON array (members.pay_methods). Synced values are untrusted:
 * always read them through parsePayMethods().
 */

import type { CurrencyCode } from './currency';

export const PAY_METHOD_KINDS = ['link', 'iban', 'bank', 'pix', 'paynow', 'promptpay'] as const;
export type PayMethodKind = (typeof PAY_METHOD_KINDS)[number];

export type PayMethod =
  /** PayPal.me, Revolut, Wise, Venmo, Cash App, Monzo… any https payment page. */
  | { kind: 'link'; url: string }
  /** IBAN account (Europe, UK, UAE…). EUR groups also get an EPC (SEPA) QR code. */
  | { kind: 'iban'; name: string; iban: string; bic?: string }
  /**
   * Bank account in separate fields (India IFSC, US routing, UK sort code, Australia BSB, SWIFT),
   * plus free text for anything else. Older entries have only `text`.
   */
  | ({ kind: 'bank'; text: string } & BankFields)
  /** Brazil. */
  | { kind: 'pix'; key: string; name: string; city: string }
  /** Singapore: +65 mobile number or a UEN. */
  | { kind: 'paynow'; proxy: string; name: string }
  /** Thailand: mobile number or 13-digit national ID. */
  | { kind: 'promptpay'; id: string };

/** Which code identifies the branch/bank next to the account number. */
export const BANK_CODE_TYPES = ['ifsc', 'routing', 'sort', 'bsb', 'swift', 'other'] as const;
export type BankCodeType = (typeof BANK_CODE_TYPES)[number];

export interface BankFields {
  /** Account holder. */
  name?: string;
  account?: string;
  code?: string;
  codeType?: BankCodeType;
  bankName?: string;
}

export const BANK_CODE_LABEL: Record<BankCodeType, string> = {
  ifsc: 'IFSC',
  routing: 'Routing number',
  sort: 'Sort code',
  bsb: 'BSB',
  swift: 'SWIFT / BIC',
  other: 'Bank code',
};

/** The code most people in a currency's country use for domestic transfers. */
export function defaultBankCodeType(currency: CurrencyCode): BankCodeType {
  switch (currency) {
    case 'INR':
      return 'ifsc';
    case 'USD':
      return 'routing';
    case 'GBP':
      return 'sort';
    case 'AUD':
      return 'bsb';
    default:
      return 'swift';
  }
}

export const isBankCodeType = (v: unknown): v is BankCodeType =>
  typeof v === 'string' && (BANK_CODE_TYPES as readonly string[]).includes(v);

/** "HDFC0001234". Fifth character is always zero. */
export const isValidIfsc = (code: string): boolean => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(code);

/** Account number without spaces or hyphens, uppercase (UK/US/IN are digits; some countries use letters). */
export const normalizeAccountNumber = (raw: string): string => raw.replace(/[\s-]/g, '').toUpperCase();

/** Bank code as stored: uppercase, no spaces; sort code and BSB keep digits only ("12-34-56" → "123456"). */
export function normalizeBankCode(raw: string, type: BankCodeType): string {
  const compact = raw.replace(/\s/g, '').toUpperCase();
  return type === 'sort' || type === 'bsb' || type === 'routing' ? compact.replace(/-/g, '') : compact;
}

export function isValidBankCode(code: string, type: BankCodeType): boolean {
  switch (type) {
    case 'ifsc':
      return isValidIfsc(code);
    case 'routing':
      return /^\d{9}$/.test(code);
    case 'sort':
    case 'bsb':
      return /^\d{6}$/.test(code);
    case 'swift':
      return isValidBic(code);
    case 'other':
      return /^[A-Z0-9-]{2,34}$/.test(code);
  }
}

/** "12-34-56" for sort codes, "123-456" for BSB; others as stored. */
export function formatBankCode(code: string, type: BankCodeType): string {
  if (type === 'sort' && /^\d{6}$/.test(code)) return code.replace(/(\d{2})(\d{2})(\d{2})/, '$1-$2-$3');
  if (type === 'bsb' && /^\d{6}$/.test(code)) return code.replace(/(\d{3})(\d{3})/, '$1-$2');
  return code;
}

export const MAX_PAY_METHODS = 6;
export const MAX_LINK_LENGTH = 300;
export const MAX_BANK_TEXT_LENGTH = 300;
export const MAX_IBAN_NAME_LENGTH = 70;
const MAX_FIELD = 300; // mirrors the server check (members_pay_methods_check)

// ── Small helpers ────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Minor units → "12.50" (exact, no floating point). */
export function minorToDecimal(minor: number, digits: number): string {
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new RangeError(`Invalid amount: ${minor}`);
  if (digits === 0) return String(minor);
  const scale = 10 ** digits;
  return `${Math.floor(minor / scale)}.${String(minor % scale).padStart(digits, '0')}`;
}

/** Latin letters and digits only (accents folded): "José Conceição" → "Jose Conceicao". */
export function asciiFold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Payment links ────────────────────────────────────────────────────────

export type LinkProvider = 'paypal' | 'revolut' | 'wise' | 'venmo' | 'cashapp' | 'monzo' | 'other';

const PROVIDER_LABEL: Record<LinkProvider, string> = {
  paypal: 'PayPal',
  revolut: 'Revolut',
  wise: 'Wise',
  venmo: 'Venmo',
  cashapp: 'Cash App',
  monzo: 'Monzo',
  other: 'Payment link',
};

/**
 * Currencies a PayPal.me link accepts in its amount (PayPal's list; INR is not on it since
 * PayPal stopped domestic payments in India). For others the link opens without an amount.
 */
const PAYPAL_CURRENCIES = new Set([
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'ILS', 'JPY', 'MXN',
  'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'SEK', 'SGD', 'THB', 'TWD', 'USD',
]);

function parseUrl(raw: string): { host: string; path: string } | null {
  const m = /^https:\/\/([^/?#\s]+)([^\s]*)$/i.exec(raw);
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  // No credentials ("https://paypal.me@evil.com") and a real domain name.
  if (host.includes('@') || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return { host: host.replace(/^www\./, ''), path: m[2] ?? '' };
}

export function linkProvider(url: string): LinkProvider {
  const u = parseUrl(url);
  if (!u) return 'other';
  if (u.host === 'paypal.me' || (u.host === 'paypal.com' && /^\/paypalme\//i.test(u.path))) return 'paypal';
  if (u.host === 'revolut.me') return 'revolut';
  if (u.host === 'wise.com' && /^\/pay\//i.test(u.path)) return 'wise';
  if (u.host === 'venmo.com' || u.host === 'account.venmo.com') return 'venmo';
  if (u.host === 'cash.app') return 'cashapp';
  if (u.host === 'monzo.me') return 'monzo';
  return 'other';
}

/** "paypal.me/rahul" for display (never the full URL with query strings). */
export function linkDisplay(url: string): string {
  const u = parseUrl(url);
  if (!u) return url;
  const path = u.path.split(/[?#]/)[0]!.replace(/\/+$/, '');
  return `${u.host}${path}`;
}

/** PayPal.me username from the link, or null. */
function paypalUser(url: string): string | null {
  const u = parseUrl(url);
  if (!u) return null;
  const path = u.path.split(/[?#]/)[0]!;
  const m = u.host === 'paypal.me' ? /^\/([A-Za-z0-9._-]+)/.exec(path) : /^\/paypalme\/([A-Za-z0-9._-]+)/i.exec(path);
  return m ? m[1]! : null;
}

export interface LinkOpen {
  url: string;
  /** True when the amount is in the link; otherwise the app copies it for the payer to paste. */
  amountIncluded: boolean;
}

/** The URL to open for paying `amountMinor` of `currency` (prefilled where the provider supports it). */
export function payLinkFor(url: string, amountMinor: number, currency: CurrencyCode, digits: number): LinkOpen {
  const user = linkProvider(url) === 'paypal' ? paypalUser(url) : null;
  if (user && PAYPAL_CURRENCIES.has(currency) && amountMinor > 0) {
    return { url: `https://paypal.me/${user}/${minorToDecimal(amountMinor, digits)}${currency}`, amountIncluded: true };
  }
  return { url, amountIncluded: false };
}

// ── IBAN ────────────────────────────────────────────────────────────────

export const normalizeIban = (raw: string): string => raw.replace(/[\s-]/g, '').toUpperCase();

/** ISO 13616: country + check digits + BBAN, mod-97 = 1. */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of rearranged) {
    const value = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
  }
  return rest === 1;
}

export const normalizeBic = (raw: string): string => raw.replace(/\s/g, '').toUpperCase();
export const isValidBic = (bic: string): boolean => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);

/** "DE89 3704 0044 0532 0130 00" */
export const formatIban = (iban: string): string => iban.replace(/(.{4})/g, '$1 ').trim();

/**
 * EPC QR code (SEPA credit transfer, EPC069-12 version 002, UTF-8). European banking apps scan it
 * and fill in name, IBAN, amount and the message. Euro only, €0.01 to €999,999,999.99.
 */
export function buildEpcPayload(input: {
  name: string;
  iban: string;
  bic?: string;
  amountCents: number;
  message: string;
}): string {
  if (!isValidIban(input.iban)) throw new Error('Invalid IBAN');
  if (input.amountCents <= 0 || input.amountCents > 99_999_999_999) throw new RangeError('EPC amount out of range');
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, MAX_IBAN_NAME_LENGTH);
  if (!name) throw new Error('Name required');
  return [
    'BCD',
    '002',
    '1', // UTF-8
    'SCT',
    input.bic && isValidBic(input.bic) ? input.bic : '',
    name,
    input.iban,
    `EUR${minorToDecimal(input.amountCents, 2)}`,
    '', // purpose
    '', // structured reference
    input.message.replace(/\s+/g, ' ').trim().slice(0, 140),
  ].join('\n');
}

// ── EMV QR (Pix, PayNow, PromptPay) ─────────────────────────────────────

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF): the checksum EMV payment QR codes end with. */
export function crc16Ccitt(text: string): string {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** One EMV TLV field: 2-digit id, 2-digit length, value (ASCII only). */
function tlv(id: string, value: string): string {
  if (value.length > 99) throw new RangeError(`EMV field ${id} too long`);
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** Appends the CRC field; the checksum covers everything before it, including "6304". */
function withCrc(body: string): string {
  const head = `${body}6304`;
  return head + crc16Ccitt(head);
}

// Pix (Banco Central do Brasil, BR Code)

export type PixKeyType = 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';

/** Normalizes a Pix key as the BR Code expects it, or null if it isn't one. */
export function normalizePixKey(raw: string): { key: string; type: PixKeyType } | null {
  const text = raw.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    return { key: text.toLowerCase(), type: 'random' };
  }
  if (text.includes('@')) {
    const email = text.toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 77 ? { key: email, type: 'email' } : null;
  }
  if (text.startsWith('+')) {
    const digits = text.replace(/[^\d]/g, '');
    return /^55\d{10,11}$/.test(digits) ? { key: `+${digits}`, type: 'phone' } : null;
  }
  const digits = text.replace(/[.\-/\s]/g, '');
  if (/^\d{11}$/.test(digits)) return { key: digits, type: 'cpf' };
  if (/^\d{14}$/.test(digits)) return { key: digits, type: 'cnpj' };
  return null;
}

/** Static Pix "copia e cola" code with the amount filled in (BRL). Paste into any Brazilian bank app. */
export function buildPixPayload(input: { key: string; name: string; city: string; amountCentavos: number }): string {
  const key = normalizePixKey(input.key);
  if (!key) throw new Error('Invalid Pix key');
  // ASCII only (accents folded), as in the Banco Central sample; case is kept.
  const name = asciiFold(input.name).slice(0, 25).trim() || 'Recebedor';
  const city = asciiFold(input.city).slice(0, 15).trim() || 'Brasil';
  const fields = [
    tlv('00', '01'),
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', key.key)),
    tlv('52', '0000'),
    tlv('53', '986'),
  ];
  if (input.amountCentavos > 0) fields.push(tlv('54', minorToDecimal(input.amountCentavos, 2)));
  fields.push(tlv('58', 'BR'), tlv('59', name), tlv('60', city), tlv('62', tlv('05', '***')));
  return withCrc(fields.join(''));
}

// PayNow (Singapore, SGQR)

/** "+6591234567" for a mobile number, or an uppercase UEN; null if neither. */
export function normalizePayNowProxy(raw: string): { proxy: string; type: 'mobile' | 'uen' } | null {
  const text = raw.replace(/[\s-]/g, '').toUpperCase();
  const mobile = /^(?:\+?65)?([89]\d{7})$/.exec(text);
  if (mobile) return { proxy: `+65${mobile[1]}`, type: 'mobile' };
  if (/^[0-9A-Z]{9,10}$/.test(text) && /\d/.test(text) && /[A-Z]/.test(text)) return { proxy: text, type: 'uen' };
  return null;
}

export function buildPayNowPayload(input: { proxy: string; name: string; amountCents: number }): string {
  const proxy = normalizePayNowProxy(input.proxy);
  if (!proxy) throw new Error('Invalid PayNow number or UEN');
  const hasAmount = input.amountCents > 0;
  const merchant =
    tlv('00', 'SG.PAYNOW') +
    tlv('01', proxy.type === 'mobile' ? '0' : '2') +
    tlv('02', proxy.proxy) +
    tlv('03', hasAmount ? '0' : '1'); // amount fixed when we set it
  const fields = [
    tlv('00', '01'),
    tlv('01', hasAmount ? '12' : '11'),
    tlv('26', merchant),
    tlv('52', '0000'),
    tlv('53', '702'),
  ];
  if (hasAmount) fields.push(tlv('54', minorToDecimal(input.amountCents, 2)));
  fields.push(
    tlv('58', 'SG'),
    tlv('59', asciiFold(input.name).slice(0, 25).trim() || 'NA'),
    tlv('60', 'Singapore'),
  );
  return withCrc(fields.join(''));
}

// PromptPay (Thailand)

/** Mobile "0812345678" / "+66812345678" or a 13-digit national ID; null if neither. */
export function normalizePromptPayId(raw: string): { id: string; type: 'mobile' | 'nationalId' } | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (/^\d{13}$/.test(digits)) return { id: digits, type: 'nationalId' };
  const mobile = /^(?:66|0)([689]\d{8})$/.exec(digits);
  return mobile ? { id: `0${mobile[1]}`, type: 'mobile' } : null;
}

export function buildPromptPayPayload(input: { id: string; amountSatang: number }): string {
  const target = normalizePromptPayId(input.id);
  if (!target) throw new Error('Invalid PromptPay ID');
  const hasAmount = input.amountSatang > 0;
  const account =
    target.type === 'mobile'
      ? tlv('01', `0066${target.id.slice(1)}`) // 0066 + number without its leading 0
      : tlv('02', target.id);
  const fields = [
    tlv('00', '01'),
    tlv('01', hasAmount ? '12' : '11'),
    tlv('29', tlv('00', 'A000000677010111') + account),
    tlv('58', 'TH'),
    tlv('53', '764'),
  ];
  if (hasAmount) fields.push(tlv('54', minorToDecimal(input.amountSatang, 2)));
  return withCrc(fields.join(''));
}

// ── Validation (forms) and parsing (stored values) ──────────────────────

export type PayMethodError =
  | 'LINK_INVALID'
  | 'IBAN_INVALID'
  | 'BIC_INVALID'
  | 'NAME_REQUIRED'
  | 'TEXT_REQUIRED'
  | 'ACCOUNT_REQUIRED'
  | 'ACCOUNT_INVALID'
  | 'BANK_CODE_INVALID'
  | 'BANK_CODE_REQUIRED'
  | 'TOO_LONG'
  | 'PIX_KEY_INVALID'
  | 'PAYNOW_INVALID'
  | 'PROMPTPAY_INVALID';

export type PayMethodResult = { ok: true; method: PayMethod } | { ok: false; error: PayMethodError };

const fail = (error: PayMethodError): PayMethodResult => ({ ok: false, error });
const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Validates and normalizes what the member typed. */
export function validatePayMethod(input: PayMethod): PayMethodResult {
  switch (input.kind) {
    case 'link': {
      let url = input.url.trim();
      if (!/^https?:\/\//i.test(url) && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(url)) url = `https://${url}`;
      if (url.length > MAX_LINK_LENGTH) return fail('TOO_LONG');
      if (!parseUrl(url)) return fail('LINK_INVALID');
      return { ok: true, method: { kind: 'link', url } };
    }
    case 'iban': {
      const iban = normalizeIban(input.iban);
      const name = clean(input.name);
      const bic = input.bic ? normalizeBic(input.bic) : '';
      if (!name) return fail('NAME_REQUIRED');
      if (name.length > MAX_IBAN_NAME_LENGTH) return fail('TOO_LONG');
      if (!isValidIban(iban)) return fail('IBAN_INVALID');
      if (bic && !isValidBic(bic)) return fail('BIC_INVALID');
      return { ok: true, method: bic ? { kind: 'iban', name, iban, bic } : { kind: 'iban', name, iban } };
    }
    case 'bank':
      return validateBank(input);
    case 'pix': {
      const key = normalizePixKey(input.key);
      const name = clean(input.name);
      if (!key) return fail('PIX_KEY_INVALID');
      if (!name) return fail('NAME_REQUIRED');
      return { ok: true, method: { kind: 'pix', key: key.key, name: name.slice(0, 60), city: clean(input.city).slice(0, 60) } };
    }
    case 'paynow': {
      const proxy = normalizePayNowProxy(input.proxy);
      if (!proxy) return fail('PAYNOW_INVALID');
      return { ok: true, method: { kind: 'paynow', proxy: proxy.proxy, name: clean(input.name).slice(0, 60) } };
    }
    case 'promptpay': {
      const id = normalizePromptPayId(input.id);
      if (!id) return fail('PROMPTPAY_INVALID');
      return { ok: true, method: { kind: 'promptpay', id: id.id } };
    }
  }
}

function validateBank(input: Extract<PayMethod, { kind: 'bank' }>): PayMethodResult {
  const text = input.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const name = clean(input.name ?? '');
  const account = normalizeAccountNumber(input.account ?? '');
  const codeType: BankCodeType = isBankCodeType(input.codeType) ? input.codeType : 'other';
  const code = normalizeBankCode(input.code ?? '', codeType);
  const bankName = clean(input.bankName ?? '');

  if (!account && !text) return fail(code || name || bankName ? 'ACCOUNT_REQUIRED' : 'TEXT_REQUIRED');
  if (text.length > MAX_BANK_TEXT_LENGTH) return fail('TOO_LONG');
  if (name.length > MAX_IBAN_NAME_LENGTH || bankName.length > MAX_IBAN_NAME_LENGTH) return fail('TOO_LONG');

  const method: Extract<PayMethod, { kind: 'bank' }> = { kind: 'bank', text };
  if (account) {
    if (!name) return fail('NAME_REQUIRED');
    // Indian accounts are 9–18 digits; elsewhere allow the IBAN-style range of letters and digits.
    const accountOk = codeType === 'ifsc' ? /^\d{9,18}$/.test(account) : /^[A-Z0-9]{4,34}$/.test(account);
    if (!accountOk) return fail('ACCOUNT_INVALID');
    method.account = account;
  }
  if (code) {
    if (!isValidBankCode(code, codeType)) return fail('BANK_CODE_INVALID');
    method.code = code;
    method.codeType = codeType;
  } else if (account && codeType === 'ifsc') {
    // An Indian account number is useless to the payer without the IFSC.
    return fail('BANK_CODE_REQUIRED');
  }
  if (name) method.name = name;
  if (bankName) method.bankName = bankName;
  return { ok: true, method };
}

/** Untrusted stored/synced value → the valid methods in it (invalid entries are dropped). */
export function parsePayMethods(value: unknown): PayMethod[] {
  let list: unknown = value;
  if (typeof value === 'string') {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: PayMethod[] = [];
  for (const item of list.slice(0, MAX_PAY_METHODS)) {
    if (!isObject(item)) continue;
    const fields = Object.values(item);
    if (fields.some((f) => typeof f === 'string' && (f.length > MAX_FIELD || CONTROL.test(f)))) continue;
    let candidate: PayMethod | null = null;
    switch (item.kind) {
      case 'link':
        candidate = { kind: 'link', url: str(item.url) ?? '' };
        break;
      case 'iban':
        candidate = { kind: 'iban', name: str(item.name) ?? '', iban: str(item.iban) ?? '', bic: str(item.bic) ?? undefined };
        break;
      case 'bank':
        candidate = {
          kind: 'bank',
          text: str(item.text) ?? '',
          name: str(item.name) ?? undefined,
          account: str(item.account) ?? undefined,
          code: str(item.code) ?? undefined,
          codeType: isBankCodeType(item.codeType) ? item.codeType : undefined,
          bankName: str(item.bankName) ?? undefined,
        };
        break;
      case 'pix':
        candidate = { kind: 'pix', key: str(item.key) ?? '', name: str(item.name) ?? '', city: str(item.city) ?? '' };
        break;
      case 'paynow':
        candidate = { kind: 'paynow', proxy: str(item.proxy) ?? '', name: str(item.name) ?? '' };
        break;
      case 'promptpay':
        candidate = { kind: 'promptpay', id: str(item.id) ?? '' };
        break;
    }
    if (!candidate) continue;
    const checked = validatePayMethod(candidate);
    // Links must already be https: a stored "http://" or bare domain is not upgraded silently.
    if (checked.ok && !(candidate.kind === 'link' && checked.method.kind === 'link' && checked.method.url !== candidate.url.trim())) {
      out.push(checked.method);
    }
  }
  return out;
}

/** For the members.pay_methods column: null when empty. */
export const serializePayMethods = (methods: readonly PayMethod[]): string | null =>
  methods.length === 0 ? null : JSON.stringify(methods.slice(0, MAX_PAY_METHODS));

/** Same method twice (same account), regardless of formatting. */
export function samePayMethod(a: PayMethod, b: PayMethod): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'link':
      return linkDisplay(a.url).toLowerCase() === linkDisplay((b as typeof a).url).toLowerCase();
    case 'iban':
      return a.iban === (b as typeof a).iban;
    case 'bank': {
      const other = b as typeof a;
      return a.account || other.account
        ? a.account === other.account && (a.code ?? '') === (other.code ?? '')
        : a.text === other.text;
    }
    case 'pix':
      return a.key === (b as typeof a).key;
    case 'paynow':
      return a.proxy === (b as typeof a).proxy;
    case 'promptpay':
      return a.id === (b as typeof a).id;
  }
}

// ── Describing ─────────────────────────────────────────────────────────

/** The only currency a method can pay in, or null when it works for any. */
export function methodCurrency(m: PayMethod): CurrencyCode | null {
  switch (m.kind) {
    case 'pix':
      return 'BRL';
    case 'paynow':
      return 'SGD';
    case 'promptpay':
      return 'THB';
    default:
      return null;
  }
}

export const worksForCurrency = (m: PayMethod, currency: CurrencyCode): boolean => {
  const only = methodCurrency(m);
  return only === null || only === currency;
};

export function methodTitle(m: PayMethod): string {
  switch (m.kind) {
    case 'link':
      return PROVIDER_LABEL[linkProvider(m.url)];
    case 'iban':
      return 'Bank transfer (IBAN)';
    case 'bank':
      return m.account ? m.bankName || 'Bank account' : 'Bank details';
    case 'pix':
      return 'Pix';
    case 'paynow':
      return 'PayNow';
    case 'promptpay':
      return 'PromptPay';
  }
}

/** One short line: "paypal.me/rahul", "DE89 3704 …3000", "+65 9123 4567". */
export function methodSummary(m: PayMethod): string {
  switch (m.kind) {
    case 'link':
      return linkDisplay(m.url);
    case 'iban':
      return `${m.iban.slice(0, 4)} ${m.iban.slice(4, 8)} … ${m.iban.slice(-4)}`;
    case 'bank':
      return m.account ? `${m.name ?? ''} · A/c ••${m.account.slice(-4)}`.replace(/^ · /, '') : m.text.split('\n')[0]!.slice(0, 40);
    case 'pix':
      return m.key;
    case 'paynow':
      return m.proxy;
    case 'promptpay':
      return m.id;
  }
}

/** Plain text for messages ("Pay me here:"), one line per method. Full values: it's for paying. */
export function methodShareLine(m: PayMethod): string {
  switch (m.kind) {
    case 'link':
      return `${methodTitle(m)}: ${m.url}`;
    case 'iban':
      return `IBAN: ${formatIban(m.iban)} (${m.name}${m.bic ? `, BIC ${m.bic}` : ''})`;
    case 'bank':
      return `Bank: ${bankLines(m).map((l) => (l.label ? `${l.label} ${l.value}` : l.value)).join(', ')}`;
    case 'pix':
      return `Pix: ${m.key}`;
    case 'paynow':
      return `PayNow: ${m.proxy}`;
    case 'promptpay':
      return `PromptPay: ${m.id}`;
  }
}

/** For the activity log (append-only, synced): which kinds, never the account details. */
export const methodKinds = (methods: readonly PayMethod[]): string[] => methods.map((m) => m.kind);

/**
 * Bank details as label/value pairs, in the order a payer types them into their banking app.
 * Free text comes last, unlabelled. Used by the Pay screen (one copy button each) and messages.
 */
export function bankLines(m: Extract<PayMethod, { kind: 'bank' }>): { label: string; value: string; copy: string }[] {
  const lines: { label: string; value: string; copy: string }[] = [];
  if (m.name) lines.push({ label: 'Name', value: m.name, copy: m.name });
  if (m.account) lines.push({ label: 'A/c', value: m.account, copy: m.account });
  if (m.code) {
    const type = m.codeType ?? 'other';
    lines.push({ label: BANK_CODE_LABEL[type], value: formatBankCode(m.code, type), copy: m.code });
  }
  if (m.bankName) lines.push({ label: 'Bank', value: m.bankName, copy: m.bankName });
  if (m.text) lines.push({ label: '', value: m.text.replace(/\n+/g, ', '), copy: m.text });
  return lines;
}
