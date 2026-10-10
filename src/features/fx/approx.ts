import { formatMoney, minorDigits, type CurrencyCode } from '@/domain/currency';
import { convertMinor } from '@/domain/fx';

import { suggestRate, type RateTable } from './rateCache';

/**
 * "≈ ₹3,900": an amount in another currency shown roughly in the user's home currency, from the
 * cached daily mid-market rate. Display only: never stored, never added into totals, and settling
 * still happens in the group's currency. Rounded to whole units (sub-unit amounts keep decimals)
 * because the rate is a day-old reference, not what anyone will actually pay.
 *
 * Null when there's nothing to show: same currency, zero (or under one minor unit once converted),
 * or no rate on this phone yet.
 */
export function approxInHome(
  minor: number,
  from: CurrencyCode,
  home: CurrencyCode,
  table: RateTable | null,
): string | null {
  if (from === home || minor === 0 || !Number.isSafeInteger(minor)) return null;
  const rate = suggestRate(table, from, home);
  if (!rate) return null;

  let converted: number;
  try {
    converted = convertMinor(Math.abs(minor), rate.rate, from, home);
  } catch {
    return null;
  }
  // Less than the smallest unit of the home currency: nothing meaningful to show.
  if (converted === 0) return null;
  const unit = 10 ** minorDigits(home);
  const rounded = Math.round(converted / unit) * unit;
  return `≈ ${formatMoney(rounded > 0 ? rounded : converted, home)}`;
}
