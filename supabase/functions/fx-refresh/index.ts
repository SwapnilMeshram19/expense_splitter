// Daily exchange rates → private.fx_rates (via public.fx_rates_upsert).
//
// Called by pg_cron (see 20261011120000_multi_currency.sql) with the shared secret in
// `x-cron-secret`. Deployed with --no-verify-jwt: the secret, not a user token, is the auth.
//
// Sources, both free and keyless:
//   1. Frankfurter v2 (api.frankfurter.dev): blended central-bank rates, ~220 currencies.
//   2. ExchangeRate-API open endpoint (open.er-api.com), only for currencies Frankfurter lacks or
//      when Frankfurter is down. Its terms require attribution, which the app shows next to any
//      rate that came from it.
// Rates are mid-market reference rates, used only to PREFILL the rate on a foreign bill. The user
// can always change it (card markup), and the rate saved with an expense never changes afterwards.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { CURRENCIES } from '../_shared/domain/currency.ts';
import { decimalFromNumber, parseRate } from '../_shared/domain/fx.ts';

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v2/rates?base=USD';
const FALLBACK_URL = 'https://open.er-api.com/v6/latest/USD';
const FETCH_TIMEOUT_MS = 15_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Source = 'frankfurter' | 'exchangerate-api';
interface RateRow {
  code: string;
  per_usd: string;
  as_of: string;
  source: Source;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Constant-time comparison so the secret can't be guessed byte by byte from response timing. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function secretKey(): string {
  const dictionary = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dictionary) {
    const value = (JSON.parse(dictionary) as Record<string, string | undefined>).default;
    if (value) return value;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No secret key in the function environment');
  return legacy;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return await response.json();
}

const SUPPORTED = new Set(CURRENCIES.map((c) => c.code));

/** A feed float as a canonical rate string, or null if it's unusable. */
function toRate(value: unknown): string | null {
  if (typeof value !== 'number') return null;
  const text = decimalFromNumber(value);
  if (!text) return null;
  const parsed = parseRate(text);
  return parsed.ok ? parsed.rate : null;
}

/** [{ date, base, quote, rate }, …] */
function parseFrankfurter(payload: unknown): RateRow[] {
  if (!Array.isArray(payload)) throw new Error('frankfurter: unexpected shape');
  const rows: RateRow[] = [];
  for (const item of payload) {
    if (typeof item !== 'object' || item === null) continue;
    const { date, base, quote, rate } = item as Record<string, unknown>;
    if (base !== 'USD' || typeof quote !== 'string' || !SUPPORTED.has(quote)) continue;
    if (typeof date !== 'string' || !ISO_DATE.test(date)) continue;
    const perUsd = toRate(rate);
    if (perUsd) rows.push({ code: quote, per_usd: perUsd, as_of: date, source: 'frankfurter' });
  }
  return rows;
}

/** { result: "success", time_last_update_unix, rates: { INR: 96.6, … } } */
function parseFallback(payload: unknown, wanted: Set<string>): RateRow[] {
  const p = payload as { result?: unknown; time_last_update_unix?: unknown; rates?: unknown };
  if (p?.result !== 'success' || typeof p.rates !== 'object' || p.rates === null) {
    throw new Error('exchangerate-api: unexpected shape');
  }
  const asOf =
    typeof p.time_last_update_unix === 'number'
      ? new Date(p.time_last_update_unix * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  const rows: RateRow[] = [];
  for (const [code, rate] of Object.entries(p.rates as Record<string, unknown>)) {
    if (!wanted.has(code)) continue;
    const perUsd = toRate(rate);
    if (perUsd) rows.push({ code, per_usd: perUsd, as_of: asOf, source: 'exchangerate-api' });
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const expected = Deno.env.get('FX_CRON_SECRET');
  const given = req.headers.get('x-cron-secret');
  if (!expected || expected.length < 16 || !given || !sameSecret(given, expected)) {
    return json(401, { error: 'UNAUTHORIZED' });
  }

  const rows = new Map<string, RateRow>();
  rows.set('USD', { code: 'USD', per_usd: '1', as_of: new Date().toISOString().slice(0, 10), source: 'frankfurter' });
  const errors: string[] = [];

  try {
    for (const row of parseFrankfurter(await fetchJson(FRANKFURTER_URL))) rows.set(row.code, row);
  } catch (e) {
    errors.push(`frankfurter: ${(e as Error).message}`);
  }

  const missing = new Set([...SUPPORTED].filter((code) => !rows.has(code)));
  if (missing.size > 0) {
    try {
      for (const row of parseFallback(await fetchJson(FALLBACK_URL), missing)) rows.set(row.code, row);
    } catch (e) {
      errors.push(`exchangerate-api: ${(e as Error).message}`);
    }
  }

  // Only USD itself: both feeds failed. Keep yesterday's table rather than writing nothing useful.
  if (rows.size <= 1) {
    console.error('fx-refresh: no rates', errors);
    return json(502, { error: 'NO_RATES', errors });
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc('fx_rates_upsert', { p_rows: [...rows.values()] });
  if (error) {
    console.error('fx-refresh: upsert failed', error.code);
    return json(500, { error: 'UPSERT_FAILED' });
  }

  const sources = { frankfurter: 0, 'exchangerate-api': 0 };
  for (const row of rows.values()) sources[row.source]++;
  console.log('fx-refresh', { written: data, sources, unavailable: SUPPORTED.size - rows.size, errors });
  return json(200, { written: data, sources, errors });
});
