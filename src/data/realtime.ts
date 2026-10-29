/**
 * Change signals: one private Realtime channel per group. When another device saves a change, the
 * server broadcasts "changed" there (no data) and we refetch that group.
 *
 * Channels are open only while it helps: app in the foreground, online, with an account. Groups
 * beyond MAX_CHANNELS (the least recently changed) still refresh on open and on pull-to-refresh.
 * Shared by the Android app and the web app.
 */
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { GROUP_CHANGED_EVENT, groupTopic, parseOrigin } from '@/domain/changeSignals';

export const MAX_CHANNELS = 20;

/** Which channels to open and close to go from `current` to `desired`. */
export function planChannels(current: Iterable<string>, desired: readonly string[]): { add: string[]; remove: string[] } {
  const have = new Set(current);
  const want = new Set(desired);
  return { add: [...want].filter((id) => !have.has(id)), remove: [...have].filter((id) => !want.has(id)) };
}

export interface ChangeSignals {
  /** Open channels for these groups (first MAX_CHANNELS), close the rest. Empty closes all. */
  update(groupIds: readonly string[]): void;
}

export function createChangeSignals(
  client: () => SupabaseClient,
  ownOrigin: () => string,
  onChange: (groupId: string) => void,
): ChangeSignals {
  const channels = new Map<string, RealtimeChannel>();

  const close = (groupId: string) => {
    const channel = channels.get(groupId);
    if (!channel) return;
    channels.delete(groupId);
    // Removing the last channel also closes the socket.
    void client().removeChannel(channel);
  };

  const open = (groupId: string) => {
    let supabase: SupabaseClient;
    try {
      supabase = client();
    } catch {
      return; // not configured in this build
    }
    const channel = supabase.channel(groupTopic(groupId), { config: { private: true } });
    channels.set(groupId, channel);
    channel
      .on('broadcast', { event: GROUP_CHANGED_EVENT }, (message: { payload?: { origin?: unknown } }) => {
        // Our own write echoing back: this device already refetched.
        if (parseOrigin(message.payload?.origin) === ownOrigin()) return;
        onChange(groupId);
      })
      .subscribe((status) => {
        // Refused (not a member any more) or a network error: drop it; the next update retries.
        if (status === 'CHANNEL_ERROR' && channels.get(groupId) === channel) {
          channels.delete(groupId);
          void supabase.removeChannel(channel);
        }
      });
  };

  return {
    update(groupIds) {
      const desired = groupIds.slice(0, MAX_CHANNELS).map((id) => id.toLowerCase());
      const { add, remove } = planChannels(channels.keys(), desired);
      remove.forEach(close);
      add.forEach(open);
    },
  };
}
