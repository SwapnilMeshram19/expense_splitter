import { useSyncExternalStore } from 'react';
import { InteractionManager, Platform } from 'react-native';
import mobileAds, {
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  MaxAdContentRating,
} from 'react-native-google-mobile-ads';

/**
 * Consent + SDK start-up, kept off the critical path.
 *
 * Order (Google's recommended flow): gather UMP consent (a form appears only where the law needs
 * one: EEA, UK, Switzerland; India gets NOT_REQUIRED instantly), set the request configuration,
 * then initialize the SDK once canRequestAds is true. If gathering fails (offline), the UMP SDK
 * falls back to the previous session's answer, so we still check canRequestAds in parallel.
 *
 * Deferred until after the first interactions finish so the Google SDK never competes with the
 * app's first render on a low-end phone. Banners only mount once `ready` is true.
 */

export interface AdsState {
  /** SDK initialized and consent allows requests: banners may load. */
  ready: boolean;
  /** EEA/UK users must be able to reopen the consent form: Account shows "Ad privacy choices". */
  privacyOptionsRequired: boolean;
}

let state: AdsState = Object.freeze({ ready: false, privacyOptionsRequired: false });
const listeners = new Set<() => void>();

function update(next: Partial<AdsState>): void {
  const merged = { ...state, ...next };
  if (
    merged.ready === state.ready &&
    merged.privacyOptionsRequired === state.privacyOptionsRequired
  ) {
    return;
  }
  state = Object.freeze(merged);
  listeners.forEach((notify) => notify());
}

let started = false;
let initializing: Promise<void> | null = null;

async function initIfAllowed(): Promise<void> {
  const info = await AdsConsent.getConsentInfo();
  update({
    privacyOptionsRequired:
      info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
  });
  if (!info.canRequestAds) {
    // Never asked yet, or withdrawn in "Ad privacy choices": banners unmount.
    update({ ready: false });
    return;
  }
  initializing ??= (async () => {
    // Family-friendly ads only: groups include parents and in-laws; a small revenue trade-off.
    await mobileAds().setRequestConfiguration({ maxAdContentRating: MaxAdContentRating.PG });
    await mobileAds().initialize();
  })().catch((error: unknown) => {
    initializing = null; // let a later call retry
    throw error;
  });
  await initializing;
  update({ ready: true });
}

/** Call once from the root layout. Safe to call again (no-op). Never throws. */
export function startAds(): () => void {
  if (started || Platform.OS === 'web') return () => {};
  started = true;
  const task = InteractionManager.runAfterInteractions(() => {
    AdsConsent.gatherConsent()
      .then(initIfAllowed)
      .catch(() => {
        // Offline or UMP error: the parallel check below uses the last known consent.
      });
    initIfAllowed().catch(() => {
      // No consent info yet (first launch offline): try again on the next app start.
    });
  });
  return () => task.cancel();
}

/** Account → "Ad privacy choices" (only shown when required). Resolves after the form closes. */
export async function showAdPrivacyOptions(): Promise<void> {
  try {
    await AdsConsent.showPrivacyOptionsForm();
  } finally {
    // Consent may have been withdrawn or granted.
    await initIfAllowed().catch(() => {});
  }
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

export function useAdsState(): AdsState {
  return useSyncExternalStore(subscribe, () => state);
}
