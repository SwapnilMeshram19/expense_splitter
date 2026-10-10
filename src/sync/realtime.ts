import type { RealtimeChannel } from '@supabase/supabase-js';

import { db } from '@/db/client';
import { editableGroups } from '@/db/repositories/editableGroups';
import { getDeviceUserId } from '@/db/session';
import { GROUP_CHANGED_EVENT, groupTopic, parseOrigin } from '@/domain/changeSignals';
import { getSupabase } from '@/lib/supabase';

import { syncOrigin } from './origin';
import { MAX_SIGNAL_CHANNELS, planChannels } from './signalPlan';

/**
 * Change signals: one private Realtime channel per group I can write to. When another phone's
 * push changes a group, the server broadcasts "changed" there and we ask the scheduler to pull.
 *
 * Channels are open only while the app is in the foreground and signed in: no background socket
 * (battery, and the free plan's concurrent-connection limit). The scheduled foreground/interval
 * syncs cover everything a missed signal would have told us.
 */

const channels = new Map<string, RealtimeChannel>();
let onChange: (() => void) | null = null;

export function setChangeSignalHandler(handler: () => void): void {
  onChange = handler;
}

/** Open/close channels to match the groups on this phone. `active` false closes everything. */
export function updateChangeSignals(active: boolean): void {
  let desired: string[] = [];
  if (active) {
    try {
      desired = editableGroups(db, getDeviceUserId())
        .slice(0, MAX_SIGNAL_CHANNELS)
        .map((g) => g.id.toLowerCase());
    } catch {
      desired = []; // DB not ready: try again after the next sync
    }
  }
  const { add, remove } = planChannels(channels.keys(), desired);
  remove.forEach(close);
  add.forEach(open);
}

function close(groupId: string): void {
  const channel = channels.get(groupId);
  if (!channel) return;
  channels.delete(groupId);
  // Removing the last channel also closes the socket (realtime-js).
  void getSupabase().removeChannel(channel);
}

function open(groupId: string): void {
  let supabase: ReturnType<typeof getSupabase>;
  try {
    supabase = getSupabase();
  } catch {
    return; // sign-in not configured in this build
  }

  const channel = supabase.channel(groupTopic(groupId), { config: { private: true } });
  channels.set(groupId, channel);

  channel
    .on('broadcast', { event: GROUP_CHANGED_EVENT }, (message: { payload?: { origin?: unknown } }) => {
      // Our own push echoing back: this phone already has the change.
      if (parseOrigin(message.payload?.origin) === syncOrigin()) return;
      onChange?.();
    })
    .subscribe((status) => {
      // Refused (group not on the server yet, or access removed) or a network error: drop it.
      // The next sync re-plans and tries again; it never retries in a tight loop.
      if (status === 'CHANNEL_ERROR' && channels.get(groupId) === channel) {
        channels.delete(groupId);
        void supabase.removeChannel(channel);
      }
    });
}
