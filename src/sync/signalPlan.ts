/**
 * Pure helpers for change-signal subscriptions (see realtime.ts). No React, no Supabase.
 */

/**
 * Channels kept open per phone. Each group is one channel on a single WebSocket; groups beyond
 * the cap (the least recently updated) still update through the scheduled sync.
 */
export const MAX_SIGNAL_CHANNELS = 20;

/** Wait after a signal before pulling, so a burst of pushes from one phone becomes one pull. */
export const REMOTE_DELAY_MS = 1_500;

/**
 * Minimum gap between signal-triggered syncs. Signals only come from the server after real
 * pushes, but a busy group (or a misbehaving phone pushing in a loop) must not make every other
 * phone pull continuously.
 */
export const REMOTE_MIN_GAP_MS = 5_000;

/** Which channels to open and close to go from `current` to `desired` (both group ids). */
export function planChannels(
  current: Iterable<string>,
  desired: readonly string[],
): { add: string[]; remove: string[] } {
  const have = new Set(current);
  const want = new Set(desired);
  return {
    add: [...want].filter((id) => !have.has(id)),
    remove: [...have].filter((id) => !want.has(id)),
  };
}

/** Delay before a signal-triggered sync, honouring the minimum gap since the last one. */
export function remoteSyncDelay(now: number, lastRemoteSyncAt: number | null): number {
  if (lastRemoteSyncAt === null) return REMOTE_DELAY_MS;
  return Math.max(REMOTE_DELAY_MS, lastRemoteSyncAt + REMOTE_MIN_GAP_MS - now);
}
