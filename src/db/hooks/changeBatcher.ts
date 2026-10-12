/**
 * Coalesces per-row table change events into at most one publish per `intervalMs`.
 *
 * Two version maps: `pending` counts every change as it arrives; `published` is what readers see
 * and only moves when subscribers are notified. Readers never see a version their subscribers
 * weren't told about (useSyncExternalStore would otherwise re-render synchronously to fix the
 * "tear"), and a burst of events becomes one notification.
 *
 * Pure (timer functions injectable), so it's unit-tested without expo-sqlite.
 */

export interface ChangeBatcher {
  record(table: string): void;
  subscribe(notify: () => void): () => void;
  /** Published versions of these tables as one comparable string. */
  snapshot(tables: readonly string[]): string;
  /** Publish now (tests, or a caller that needs the screen current immediately). */
  flush(): void;
}

export function createChangeBatcher(
  intervalMs: number,
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown;
  } = { setTimeout: (fn, ms) => setTimeout(fn, ms) },
): ChangeBatcher {
  const pending = new Map<string, number>();
  const published = new Map<string, number>();
  const subscribers = new Set<() => void>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    let changed = false;
    for (const [table, version] of pending) {
      if (published.get(table) !== version) {
        published.set(table, version);
        changed = true;
      }
    }
    if (changed) subscribers.forEach((notify) => notify());
  };

  return {
    record(table) {
      pending.set(table, (pending.get(table) ?? 0) + 1);
      if (!scheduled) {
        scheduled = true;
        timers.setTimeout(flush, intervalMs);
      }
    },
    subscribe(notify) {
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
      };
    },
    snapshot(tables) {
      return tables.map((t) => published.get(t) ?? 0).join(':');
    },
    flush,
  };
}
