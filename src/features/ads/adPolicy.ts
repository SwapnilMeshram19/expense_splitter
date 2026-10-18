/**
 * Where ads may appear and which ad unit to use. Pure: no native module, so it's unit-tested and
 * safe to import anywhere.
 *
 * Placement rules (decided with the user):
 * - Only Home (below the groups) and inside long Activity lists.
 * - Never on add-expense, Pay, Settle, Join, or any form. No interstitials, no app-open ads.
 * - Never before the user has a real group: someone exploring the example group on day one sees no
 *   ads at all.
 */

export type AdPlacement = 'home' | 'activity';

/** An AdMob ad unit ID (slash, not tilde: tilde is an app ID). */
const AD_UNIT_ID = /^ca-app-pub-\d{16}\/\d{10}$/;

/**
 * Development builds always use the test unit (test ads, no account risk). Production uses the
 * configured unit; a missing or malformed one means no ad, never a crash or a test ad.
 */
export function chooseAdUnit(
  variant: 'development' | 'production',
  configured: string | undefined,
  testUnitId: string,
): string | null {
  if (variant === 'development') return testUnitId;
  const id = configured?.trim();
  return id && AD_UNIT_ID.test(id) ? id : null;
}

/** Home shows its banner only once there's a group (never on the empty, first-run Home). */
export function shouldShowHomeAd(groupCount: number): boolean {
  return groupCount > 0;
}

/** Only lists long enough that one ad doesn't dominate: at most one, after the 8th entry. */
export const ACTIVITY_AD_MIN_ITEMS = 12;
export const ACTIVITY_AD_AFTER = 8;

export interface AdRow {
  kind: 'ad';
  id: 'ad-activity';
}

export const ACTIVITY_AD_ROW: AdRow = Object.freeze({ kind: 'ad', id: 'ad-activity' });

export function withActivityAd<T>(items: readonly T[], showAds: boolean): (T | AdRow)[] {
  if (!showAds || items.length < ACTIVITY_AD_MIN_ITEMS) return [...items];
  return [...items.slice(0, ACTIVITY_AD_AFTER), ACTIVITY_AD_ROW, ...items.slice(ACTIVITY_AD_AFTER)];
}

export const isAdRow = (row: unknown): row is AdRow =>
  typeof row === 'object' && row !== null && (row as { kind?: unknown }).kind === 'ad';
