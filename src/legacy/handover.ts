/**
 * One-time hand-over from the offline-first builds (1.0.x) to the server-first data layer.
 *
 * Those builds kept every group in this phone's SQLite and synced in the background. On the first
 * launch of this version, anything still only on the phone (unsynced edits, groups made while
 * signed out) is uploaded once with the old sync engine, under the account the app now has
 * (anonymous or saved). Then the old tables are emptied: from here on the server is the only copy.
 *
 * Remove this folder (and src/db/repositories) once no 1.0.x install can be left: one release.
 */
import { count } from 'drizzle-orm';

import { appContext } from '@/db/appContext';
import { linkAccount } from '@/db/repositories/identity';
import { getSetting, setSetting } from '@/db/repositories/profile';
import {
  activityLog,
  expensePayers,
  expenseShares,
  expenses,
  groups,
  members,
  recurringRules,
  settlements,
} from '@/db/schema';

import { GUIDE_SEEN_KEY } from '@/features/onboarding/guide';

import { runSync } from './sync/runSync';
import { supabaseTransport } from './sync/transport';

export const HANDOVER_DONE_KEY = 'server_first_handover_done';

let running: Promise<void> | null = null;

/** Safe to call on every sign-in: does nothing once done. Throws (and retries next time) if offline. */
export function runLegacyHandover(userId: string): Promise<void> {
  running ??= handover(userId).finally(() => {
    running = null;
  });
  return running;
}

async function handover(userId: string): Promise<void> {
  const ctx = appContext;
  if (getSetting(ctx, HANDOVER_DONE_KEY)) return;

  const localGroups = ctx.db.select({ n: count() }).from(groups).get()?.n ?? 0;
  if (localGroups === 0) {
    setSetting(ctx, HANDOVER_DONE_KEY, String(Date.now()));
    return;
  }

  // Groups made while signed out belong to this phone's device id: give them to this account.
  // A phone that was signed in to a different account keeps that data on the server under it;
  // nothing here is uploaded under someone else's name.
  const linked = linkAccount(ctx, userId);
  if (linked.ok) {
    await runSync(ctx, supabaseTransport);
    // An existing user: never show them the first-run guide once their old groups are gone.
    setSetting(ctx, GUIDE_SEEN_KEY, '1');
    wipeLocalData();
  }
  // Otherwise the old tables are left as they are (never shown again, but not destroyed).
  setSetting(ctx, HANDOVER_DONE_KEY, String(Date.now()));
}

/** Empty the old data tables (settings and receipt photos stay). Children before parents. */
function wipeLocalData(): void {
  const db = appContext.db;
  db.transaction((tx) => {
    tx.delete(activityLog).run();
    tx.delete(expensePayers).run();
    tx.delete(expenseShares).run();
    // Expenses reference members (created_by): expenses and rules first, then settlements, members, groups.
    tx.delete(expenses).run();
    tx.delete(recurringRules).run();
    tx.delete(settlements).run();
    tx.delete(members).run();
    tx.delete(groups).run();
  });
}
