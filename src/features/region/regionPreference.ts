import { eq } from 'drizzle-orm';
import { useSyncExternalStore } from 'react';

import type { RepoContext } from '@/db/context';
import { getSetting, setSetting } from '@/db/repositories/profile';
import { settings } from '@/db/schema';
import {
  currencyInfo,
  DEFAULT_CURRENCY,
  isSupportedCurrency,
  setIndianGroupingForInr,
  type CurrencyCode,
} from '@/domain/currency';

/**
 * Region settings for a global app: the user's home currency and how rupees are grouped.
 *
 * - Home currency: the default for new groups, listed first in currency pickers, and the currency
 *   the "≈ in your currency" hints convert to. Detected from the phone (an en-US phone → USD) until
 *   the user picks one in Account; the choice is stored locally and never synced, like the theme.
 * - INR grouping: lakh/crore (₹1,23,456) on phones set to India or with no region, thousands
 *   (₹123,456) elsewhere. Always follows the phone.
 *
 * A tiny external store (like ui/themePreference) so screens re-render when the phone's language
 * settings change while the app is in the background.
 */

/** What the app needs from the phone's locale list (expo-localization getLocales()). */
export interface DeviceLocale {
  regionCode: string | null;
  currencyCode: string | null;
}

export const HOME_CURRENCY_KEY = 'home_currency';

export interface RegionPreference {
  homeCurrency: CurrencyCode;
  /** True when homeCurrency comes from the phone (the user hasn't picked one). */
  homeIsAutomatic: boolean;
  /** What the phone suggests (shown as "Automatic (USD)"). */
  detectedCurrency: CurrencyCode;
  indianGrouping: boolean;
}

const usable = (code: string | null | undefined): code is CurrencyCode =>
  !!code && isSupportedCurrency(code) && !currencyInfo(code).legacy;

/**
 * The phone's currency: the first preferred locale with a supported, current currency. India is
 * the default market, so anything unknown falls back to INR.
 */
export function detectHomeCurrency(locales: readonly DeviceLocale[]): CurrencyCode {
  for (const locale of locales) {
    if (usable(locale.currencyCode)) return locale.currencyCode;
  }
  return DEFAULT_CURRENCY;
}

/** Lakh/crore for India, or when the phone doesn't say (India-first default). */
export function prefersIndianGrouping(locales: readonly DeviceLocale[]): boolean {
  const region = locales[0]?.regionCode ?? null;
  return region === null || region === '' || region.toUpperCase() === 'IN';
}

export function resolveRegionPreference(
  saved: string | null,
  locales: readonly DeviceLocale[],
): RegionPreference {
  const detectedCurrency = detectHomeCurrency(locales);
  // A saved code that's unknown or retired (a newer build's data, BGN) falls back to automatic.
  const homeIsAutomatic = !usable(saved);
  return {
    homeCurrency: homeIsAutomatic ? detectedCurrency : (saved as CurrencyCode),
    homeIsAutomatic,
    detectedCurrency,
    indianGrouping: prefersIndianGrouping(locales),
  };
}

let current: RegionPreference = Object.freeze(resolveRegionPreference(null, []));
const listeners = new Set<() => void>();

function emit(next: RegionPreference): void {
  setIndianGroupingForInr(next.indianGrouping);
  if (
    next.homeCurrency === current.homeCurrency &&
    next.homeIsAutomatic === current.homeIsAutomatic &&
    next.detectedCurrency === current.detectedCurrency &&
    next.indianGrouping === current.indianGrouping
  ) {
    return;
  }
  current = Object.freeze({ ...next });
  listeners.forEach((notify) => notify());
}

/** Read the saved choice and the phone's settings. Call after migrations, and on foreground. */
export function loadRegionPreference(
  ctx: RepoContext,
  locales: readonly DeviceLocale[],
): RegionPreference {
  emit(resolveRegionPreference(getSetting(ctx, HOME_CURRENCY_KEY), locales));
  return current;
}

/** Pick a home currency, or null to follow the phone again. */
export function setHomeCurrency(
  ctx: RepoContext,
  code: CurrencyCode | null,
  locales: readonly DeviceLocale[],
): void {
  if (code === null) ctx.db.delete(settings).where(eq(settings.key, HOME_CURRENCY_KEY)).run();
  else if (usable(code)) setSetting(ctx, HOME_CURRENCY_KEY, code);
  else return;
  loadRegionPreference(ctx, locales);
}

export const getRegionPreference = (): RegionPreference => current;

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useRegionPreference(): RegionPreference {
  return useSyncExternalStore(subscribe, getRegionPreference);
}

/** Test-only: back to the defaults (INR, lakh grouping). */
export function resetRegionPreferenceForTests(): void {
  current = Object.freeze(resolveRegionPreference(null, []));
  setIndianGroupingForInr(true);
}
