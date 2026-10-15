import type { CurrencyCode } from '@/domain/currency';
import { convertMinor, formatRate } from '@/domain/fx';
import { suggestRate, type RateTable } from '@/features/fx/rateCache';
import { useRateTable } from '@/features/fx/useRateTable';

/**
 * "Pay in ₹ with UPI" for a group in another currency: Indians on a trip abroad still settle
 * among themselves in rupees. The debt is converted at today's mid-market rate; the payment is
 * recorded in the group's currency, so balances stay exact. A few paise of difference against
 * what the bank used is expected and is why the rate is shown.
 */
export interface InrConversion {
  inrPaise: number;
  rate: string;
  /** "1 THB = ₹2.43" */
  label: string;
  asOf: string;
}

export function inrConversion(
  table: RateTable | null,
  currency: CurrencyCode,
  amountMinor: number | null,
): InrConversion | null {
  if (currency === 'INR' || amountMinor === null || amountMinor <= 0) return null;
  const suggestion = suggestRate(table, currency, 'INR');
  if (!suggestion) return null;
  try {
    const inrPaise = convertMinor(amountMinor, suggestion.rate, currency, 'INR');
    if (inrPaise <= 0) return null;
    return {
      inrPaise,
      rate: suggestion.rate,
      label: `1 ${currency} = ₹${formatRate(suggestion.rate)}`,
      asOf: suggestion.asOf,
    };
  } catch {
    return null;
  }
}

/** Rates are fetched only when needed: a non-INR group and someone with a UPI ID. */
export function useInrConversion(currency: CurrencyCode, amountMinor: number | null, needed: boolean) {
  const table = useRateTable(needed && currency !== 'INR');
  return needed ? inrConversion(table, currency, amountMinor) : null;
}
