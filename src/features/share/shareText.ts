import { useEffect, useState } from 'react';
import { AppState, Linking, Share } from 'react-native';

import { clampShareText, WHATSAPP_PROBE_URL, whatsappSendUrl } from './whatsapp';

/**
 * WhatsApp first, the system share sheet as the fallback (and for "other apps").
 *
 * Checking for WhatsApp needs the whatsapp scheme in the manifest's <queries> (Android 11+ package
 * visibility; see plugins/with-upi-queries.js). Without it canOpenURL says false and we simply
 * show the share sheet button. Opening never depends on the check: if WhatsApp is gone by the time
 * of the tap, openURL fails and the share sheet opens instead.
 */

let cached: boolean | null = null;

export async function isWhatsAppInstalled(): Promise<boolean> {
  try {
    cached = await Linking.canOpenURL(WHATSAPP_PROBE_URL);
  } catch {
    cached = false;
  }
  return cached;
}

/** Whether to offer a WhatsApp button. Re-checked when the app comes back (WhatsApp installed meanwhile). */
export function useWhatsAppAvailable(): boolean {
  const [available, setAvailable] = useState(cached ?? false);
  useEffect(() => {
    let alive = true;
    const check = () =>
      void isWhatsAppInstalled().then((value) => {
        if (alive) setAvailable(value);
      });
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return available;
}

/** Share sheet with the text (WhatsApp, SMS, Telegram, Gmail…). */
export async function shareTextElsewhere(text: string, title?: string): Promise<void> {
  try {
    await Share.share({ message: clampShareText(text), title });
  } catch {
    // Dismissed or no target: nothing to do.
  }
}

/** Open WhatsApp with the text; falls back to the share sheet. */
export async function shareTextOnWhatsApp(text: string): Promise<void> {
  try {
    await Linking.openURL(whatsappSendUrl(text));
  } catch {
    await shareTextElsewhere(text);
  }
}
