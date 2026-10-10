import { CURRENCIES, POPULAR_CURRENCIES, currencyInfo, type CurrencyInfo } from '@/domain/currency';

/**
 * Currencies for the picker: `pinned` first (current choice, the group's currency, recent ones),
 * then the popular list, then everything else A–Z. With a query: code prefix matches first, then
 * name matches ("dol" finds every dollar, "us" finds USD before AUD).
 */
export function currencyOptions(query: string, pinned: readonly string[] = []): CurrencyInfo[] {
  const q = query.trim().toLowerCase();
  if (q) {
    const byCode = CURRENCIES.filter((c) => c.code.toLowerCase().startsWith(q));
    const byName = CURRENCIES.filter(
      (c) =>
        !byCode.includes(c) && (c.name.toLowerCase().includes(q) || c.symbol.toLowerCase() === q),
    );
    return [...byCode, ...byName];
  }
  const head = [...new Set([...pinned, ...POPULAR_CURRENCIES])].map(currencyInfo);
  const headCodes = new Set(head.map((c) => c.code));
  return [...head, ...CURRENCIES.filter((c) => !headCodes.has(c.code))];
}
