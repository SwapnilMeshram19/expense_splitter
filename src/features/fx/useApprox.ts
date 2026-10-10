import { useCallback } from 'react';

import type { CurrencyCode } from '@/domain/currency';
import { useRegionPreference } from '@/features/region/regionPreference';

import { approxInHome } from './approx';
import { useRateTable } from './useRateTable';

/**
 * Formatter for "≈ in your currency" hints on screens that show amounts from several currencies.
 * `needed`: some amount on screen is in another currency. Only then are the cached rates
 * refreshed (at most every few hours), so screens with only home-currency groups never touch the
 * network.
 */
export function useApprox(needed: boolean): (minor: number, from: CurrencyCode) => string | null {
  const { homeCurrency } = useRegionPreference();
  const table = useRateTable(needed);
  return useCallback(
    (minor: number, from: CurrencyCode) => approxInHome(minor, from, homeCurrency, table),
    [homeCurrency, table],
  );
}
