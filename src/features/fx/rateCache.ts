/**
 * Daily exchange rates, cached on the phone so foreign bills can be entered offline.
 *
 * The server keeps one row per currency ("units per 1 USD", with the provider's date and source),
 * refreshed once a day by a pg_cron job. The phone downloads the whole table (~6 KB) at most every
 * few hours, and only when someone actually enters a foreign bill, so free-tier egress stays tiny.
 * A suggested rate is only a prefill: the rate saved with an expense is whatever the user confirms.
 *
 * Local-only (settings table, never synced): rates are public data, nothing personal.
 */
import { eq } from 'drizzle-orm';

import type { RepoContext } from '@/db/context';
import { settings } from '@/db/schema';
import { isSupportedCurrency, type CurrencyCode } from '@/domain/currency';
import { crossRate, parseRate } from '@/domain/fx';

export const FX_RATES_KEY = 'fx_rates';
/** Re-download at most this often (rates change once a day). */
export const FX_REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

export type RateSource = 'frankfurter' | 'exchangerate-api';

export interface CachedRate {
  /** Units of the currency per 1 USD, canonical decimal string. */
  perUsd: string;
  /** Provider's date for this rate, 'YYYY-MM-DD'. */
  asOf: string;
  source: RateSource;
}

export interface RateTable {
  fetchedAt: number;
  rates: Record<CurrencyCode, CachedRate>;
}

export interface SuggestedRate {
  rate: string;
  /** The older of the two rates' dates. */
  asOf: string;
  /** Sources involved, for attribution (ExchangeRate-API requires it). */
  sources: RateSource[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES: readonly RateSource[] = ['frankfurter', 'exchangerate-api'];

/**
 * Parse the server's compact payload: { "rates": { "INR": ["96.64", "2026-10-10", "frankfurter"] } }.
 * Anything malformed is dropped row by row; a hostile or broken response can't inject a bad rate.
 */
export function parseRatePayload(payload: unknown, fetchedAt: number): RateTable | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = (payload as { rates?: unknown }).rates;
  if (typeof raw !== 'object' || raw === null) return null;

  const rates: Record<string, CachedRate> = {};
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSupportedCurrency(code) || !Array.isArray(value)) continue;
    const [perUsd, asOf, source] = value as unknown[];
    const parsed = parseRate(perUsd);
    if (!parsed.ok || typeof asOf !== 'string' || !ISO_DATE.test(asOf)) continue;
    if (!SOURCES.includes(source as RateSource)) continue;
    rates[code] = { perUsd: parsed.rate, asOf, source: source as RateSource };
  }
  // USD is the base: always present, even if the feed leaves it out.
  rates.USD ??= {
    perUsd: '1',
    asOf: Object.values(rates)[0]?.asOf ?? '1970-01-01',
    source: 'frankfurter',
  };
  return Object.keys(rates).length > 1 ? { fetchedAt, rates } : null;
}

export function getCachedRates(ctx: RepoContext): RateTable | null {
  const raw = ctx.db.select().from(settings).where(eq(settings.key, FX_RATES_KEY)).get()?.value;
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as RateTable;
    return typeof value.fetchedAt === 'number' && typeof value.rates === 'object' && value.rates
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveRates(ctx: RepoContext, table: RateTable): void {
  const value = JSON.stringify(table);
  ctx.db
    .insert(settings)
    .values({ key: FX_RATES_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export const ratesAreStale = (table: RateTable | null, now: number): boolean =>
  !table || now - table.fetchedAt > FX_REFRESH_AFTER_MS || now < table.fetchedAt;

/** Suggested rate for a bill in `from` added to a `to` group, or null if either is unknown. */
export function suggestRate(
  table: RateTable | null,
  from: CurrencyCode,
  to: CurrencyCode,
): SuggestedRate | null {
  if (!table || from === to) return null;
  const a = table.rates[from];
  const b = table.rates[to];
  if (!a || !b) return null;
  const rate = crossRate(a.perUsd, b.perUsd);
  if (!rate) return null;
  return {
    rate,
    asOf: a.asOf < b.asOf ? a.asOf : b.asOf,
    sources: [...new Set([a.source, b.source])],
  };
}
