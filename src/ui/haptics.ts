import * as Haptics from 'expo-haptics';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import type { RepoContext } from '@/db/context';
import { getSetting, setSetting } from '@/db/repositories/profile';

/**
 * Light physical feedback for a few meaningful moments: picking an option, saving an expense,
 * recording a payment, confirming something destructive. Not on every tap: constant buzzing reads
 * as cheap and drains battery on low-end phones.
 *
 * Android uses the view haptics engine (performHapticFeedback), not the Vibrator: it's crisper,
 * needs no permission and follows the phone's own "Touch feedback" setting. There's also an
 * in-app switch (Account → Appearance), stored locally like the theme.
 */

export type HapticKind = 'selection' | 'success' | 'warning';

/**
 * The best Android effect for this OS version. CONFIRM/REJECT exist from API 30 and SEGMENT_TICK
 * from API 34; on older phones an unknown constant does nothing, so fall back to effects every
 * version has.
 */
export function androidEffect(kind: HapticKind, apiLevel: number): Haptics.AndroidHaptics {
  switch (kind) {
    case 'selection':
      return apiLevel >= 34
        ? Haptics.AndroidHaptics.Segment_Tick
        : Haptics.AndroidHaptics.Clock_Tick;
    case 'success':
      return apiLevel >= 30 ? Haptics.AndroidHaptics.Confirm : Haptics.AndroidHaptics.Virtual_Key;
    case 'warning':
      return apiLevel >= 30 ? Haptics.AndroidHaptics.Reject : Haptics.AndroidHaptics.Long_Press;
  }
}

export const HAPTICS_KEY = 'ui_haptics';

/** On unless the user turned it off; unknown values (other app versions) read as on. */
export const parseHapticsEnabled = (value: string | null): boolean => value !== 'off';

let enabled = true;
const listeners = new Set<() => void>();

export function loadHapticsPreference(ctx: RepoContext): void {
  enabled = parseHapticsEnabled(getSetting(ctx, HAPTICS_KEY));
  listeners.forEach((notify) => notify());
}

export function setHapticsEnabled(ctx: RepoContext, value: boolean): void {
  setSetting(ctx, HAPTICS_KEY, value ? 'on' : 'off');
  enabled = value;
  listeners.forEach((notify) => notify());
  // Feel what you just switched on.
  if (value) haptic('selection');
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
};

export function useHapticsEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}

/** Fire and forget: never awaited, never throws (no haptics hardware, module missing in tests). */
export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  let pending: Promise<void>;
  try {
    if (Platform.OS === 'android') {
      pending = Haptics.performAndroidHapticsAsync(androidEffect(kind, Number(Platform.Version)));
    } else if (kind === 'selection') {
      pending = Haptics.selectionAsync();
    } else {
      pending = Haptics.notificationAsync(
        kind === 'success'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    }
  } catch {
    return;
  }
  pending.catch(() => {});
}
