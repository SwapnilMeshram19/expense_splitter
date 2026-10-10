import type { RepoContext } from '@/db/context';
import { getSupabase } from '@/lib/supabase';

import {
  getCachedRates,
  parseRatePayload,
  ratesAreStale,
  saveRates,
  type RateTable,
} from './rateCache';

let inFlight: Promise<RateTable | null> | null = null;

/**
 * Download today's rates if the cached copy is older than a few hours. Works signed out: the
 * `fx_rates` RPC is public (rates are public data). Never throws: offline, missing config or a
 * bad response all just keep the cached table, and the user can always type a rate.
 */
export function refreshRatesIfStale(ctx: RepoContext): Promise<RateTable | null> {
  const cached = getCachedRates(ctx);
  if (!ratesAreStale(cached, ctx.now())) return Promise.resolve(cached);
  inFlight ??= (async () => {
    try {
      const { data, error } = await getSupabase().rpc('fx_rates');
      if (error) return cached;
      const table = parseRatePayload(data, ctx.now());
      if (!table) return cached;
      saveRates(ctx, table);
      return table;
    } catch {
      return cached;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
