import { getLocales } from 'expo-localization';
import { AppState } from 'react-native';

import { appContext } from '@/db/appContext';

import { loadRegionPreference, setHomeCurrency, type DeviceLocale } from './regionPreference';

/** The phone's preferred locales, in order. Never throws: an empty list means "unknown". */
export function readDeviceLocales(): DeviceLocale[] {
  try {
    return getLocales().map((l) => ({ regionCode: l.regionCode, currencyCode: l.currencyCode }));
  } catch {
    return [];
  }
}

/**
 * Load the region preference now and again whenever the app returns to the foreground: Android
 * lets people change language/region without restarting the app. Returns an unsubscribe.
 */
export function startRegionPreference(): () => void {
  loadRegionPreference(appContext, readDeviceLocales());
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') loadRegionPreference(appContext, readDeviceLocales());
  });
  return () => subscription.remove();
}

/** Account screen: pick a home currency, or null for "Automatic". */
export const chooseHomeCurrency = (code: string | null): void =>
  setHomeCurrency(appContext, code, readDeviceLocales());
