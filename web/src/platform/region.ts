/**
 * Lakh/crore grouping for INR when the reader is in India, like the app does from the phone's
 * region: ₹1,23,456 for Indian readers, ₹123,456 for everyone else.
 * Browser signals: an Indian time zone or an -IN locale. Defaults to Indian grouping.
 */
import { setIndianGroupingForInr } from '@/domain/currency';

const INDIAN_ZONES = new Set(['Asia/Kolkata', 'Asia/Calcutta']);

export function applyRegion(): void {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    zone = '';
  }
  const locales =
    typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language];
  const inIndia = INDIAN_ZONES.has(zone) || locales.some((l) => /-IN$/i.test(l ?? ''));
  // Unknown (no zone, no locales): keep the default (Indian), the app's home market.
  setIndianGroupingForInr(inIndia || (zone === '' && locales.length === 0));
}

/** IANA zone for recurring rules (later) and dates; falls back to India. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}
