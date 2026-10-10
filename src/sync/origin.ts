import { newId } from '@/lib/newId';

let origin: string | null = null;

/**
 * Random id for this app run, sent with every push (X-Sync-Origin) and echoed back in the
 * change signal, so the phone that pushed doesn't pull its own change a second time.
 * Not persisted and not tied to the account: it identifies nothing beyond "this run".
 */
export function syncOrigin(): string {
  origin ??= newId();
  return origin;
}
