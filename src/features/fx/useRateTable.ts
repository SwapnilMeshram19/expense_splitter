import { useEffect, useState } from 'react';

import { appContext } from '@/db/appContext';

import { getCachedRates, type RateTable } from './rateCache';
import { refreshRatesIfStale } from './refreshRates';

/**
 * Cached daily rates, refreshed in the background when `active` (a foreign currency is chosen) and
 * the copy is a few hours old. Inactive forms never touch the network.
 */
export function useRateTable(active: boolean): RateTable | null {
  const [table, setTable] = useState<RateTable | null>(() => getCachedRates(appContext));

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void refreshRatesIfStale(appContext).then((fresh) => {
      if (!cancelled && fresh) setTable(fresh);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return table;
}
