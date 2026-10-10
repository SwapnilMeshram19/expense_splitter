import { getCalendars } from 'expo-localization';

/** The phone's IANA time zone for new rules; India when the phone doesn't say. */
export function deviceTimeZone(): string {
  try {
    const zone = getCalendars()[0]?.timeZone;
    return zone && /^([A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}|UTC)$/.test(zone) ? zone : 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}
