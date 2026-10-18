import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { router } from 'expo-router';
import { Alert, AppState, Platform } from 'react-native';
import { useSyncExternalStore } from 'react';

import { appContext } from '@/db/appContext';
import { db } from '@/db/client';
import { getGroup } from '@/db/repositories/groups';
import { getSetting, setSetting } from '@/db/repositories/profile';
import { members } from '@/db/schema';
import { getDeviceUserId } from '@/db/session';
import { usesIndianGroupingForInr } from '@/domain/currency';
import { onBeforeSignOut } from '@/features/auth/authStore';
import { loadOverview } from '@/features/overview/loadOverview';
import { getSupabase } from '@/lib/supabase';
import { onSyncSucceeded, syncNow } from '@/sync/syncService';

import { loadNotifications, notificationsInstalled } from './native';
import {
  getNotificationPrefs,
  needsRegistration,
  NOTIFICATIONS_ASKED_KEY,
  parsePushRegistration,
  PUSH_REGISTRATION_KEY,
  registrationSignature,
  wantsPush,
} from './prefs';
import { weeklyReminderText } from './reminderText';

/**
 * Notifications on the phone:
 * - push (server → FCM → here): registered with the server while signed in, permission granted
 *   and at least one push type wanted; unregistered on sign-out or when all are turned off;
 * - the weekly settle-up reminder, scheduled locally (Sunday 7 pm) with current totals, and
 *   re-scheduled after every sync and whenever the app comes to the foreground;
 * - tapping a notification opens its group (or the Settle tab for the reminder).
 */

export const ACTIVITY_CHANNEL = 'activity';
export const REMINDER_CHANNEL = 'reminders';
const WEEKLY_ID = 'weekly-settle-up';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const devLog = (label: string, e?: unknown) => {
  if (__DEV__) console.log(`[notifications] ${label}`, e instanceof Error ? e.message : (e ?? ''));
};

// ── Permission state (for the Account tab) ─────────────────────────────

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

let permission: PermissionState = notificationsInstalled() ? 'undetermined' : 'unavailable';
const permissionListeners = new Set<() => void>();

function setPermission(next: PermissionState): void {
  if (next === permission) return;
  permission = next;
  permissionListeners.forEach((notify) => notify());
}

export function usePermissionState(): PermissionState {
  return useSyncExternalStore(
    (notify) => {
      permissionListeners.add(notify);
      return () => {
        permissionListeners.delete(notify);
      };
    },
    () => permission,
  );
}

export async function refreshPermission(): Promise<PermissionState> {
  const N = loadNotifications();
  if (!N) {
    setPermission('unavailable');
    return 'unavailable';
  }
  try {
    const status = await (await N).getPermissionsAsync();
    setPermission(status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied');
  } catch (e) {
    devLog('permission check failed', e);
  }
  return permission;
}

/** Ask Android (13+) for permission. False when refused or not possible. */
export async function requestPermission(): Promise<boolean> {
  const N = loadNotifications();
  if (!N) return false;
  try {
    const n = await N;
    await ensureChannels(n);
    const status = await n.requestPermissionsAsync();
    setPermission(status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied');
    return status.granted;
  } catch (e) {
    devLog('permission request failed', e);
    return false;
  }
}

// ── Push registration ──────────────────────────────────────────────────

async function signedInUserId(): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

async function unregisterStored(): Promise<void> {
  const stored = parsePushRegistration(getSetting(appContext, PUSH_REGISTRATION_KEY));
  if (!stored) return;
  const { error } = await getSupabase().rpc('unregister_push_device', { p_token: stored.token });
  if (error) throw new Error(error.message);
  setSetting(appContext, PUSH_REGISTRATION_KEY, '');
}

let registering: Promise<void> | null = null;

/** Make the server's copy match this phone. Cheap when nothing changed. Never throws. */
export function syncPushRegistration(): Promise<void> {
  registering ??= (async () => {
    const N = loadNotifications();
    if (!N) return;
    const userId = await signedInUserId();
    if (!userId) return;
    const prefs = getNotificationPrefs(appContext);
    const state = await refreshPermission();

    if (!wantsPush(prefs) || state !== 'granted') {
      await unregisterStored();
      return;
    }

    let token: string;
    try {
      const device = await (await N).getDevicePushTokenAsync();
      if (typeof device.data !== 'string') return;
      token = device.data;
    } catch (e) {
      // No Firebase config in this build (google-services.json), or Play services missing.
      devLog('no push token', e);
      return;
    }

    const indian = usesIndianGroupingForInr();
    const signature = registrationSignature(token, userId, prefs, indian);
    const stored = parsePushRegistration(getSetting(appContext, PUSH_REGISTRATION_KEY));
    if (!needsRegistration(stored, signature, Date.now())) return;

    const { error } = await getSupabase().rpc('register_push_device', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_expenses: prefs.expenses,
      p_payments: prefs.payments,
      p_budget: prefs.budget,
      p_indian_grouping: indian,
    });
    if (error) {
      devLog('register failed', error.message);
      return;
    }
    setSetting(
      appContext,
      PUSH_REGISTRATION_KEY,
      JSON.stringify({ token, signature, at: Date.now() }),
    );
  })()
    .catch((e: unknown) => devLog('registration failed', e))
    .finally(() => {
      registering = null;
    });
  return registering;
}

/**
 * Before signing out: the server forgets this phone, and the FCM token itself is deleted, so even
 * if the server call fails (offline) the next send gets "unregistered" and drops it. A shared
 * phone never keeps receiving the previous account's notifications.
 */
async function forgetPushOnSignOut(): Promise<void> {
  const N = loadNotifications();
  if (!N) return;
  try {
    await unregisterStored();
  } catch (e) {
    devLog('server unregister failed', e);
  }
  setSetting(appContext, PUSH_REGISTRATION_KEY, '');
  try {
    await (await N).unregisterForNotificationsAsync();
  } catch (e) {
    devLog('token delete failed', e);
  }
}

// ── Weekly reminder ────────────────────────────────────────────────────

export async function refreshWeeklyReminder(): Promise<void> {
  const N = loadNotifications();
  if (!N) return;
  try {
    const n = await N;
    await n.cancelScheduledNotificationAsync(WEEKLY_ID).catch(() => undefined);
    if (!getNotificationPrefs(appContext).weekly || permission !== 'granted') return;
    const text = weeklyReminderText(loadOverview(db, getDeviceUserId()).totals);
    if (!text) return;
    await n.scheduleNotificationAsync({
      identifier: WEEKLY_ID,
      content: { title: text.title, body: text.body, data: { type: 'settle' } },
      trigger: {
        type: n.SchedulableTriggerInputTypes.WEEKLY,
        weekday: 1, // Sunday
        hour: 19,
        minute: 0,
        channelId: REMINDER_CHANNEL,
      },
    });
  } catch (e) {
    devLog('weekly reminder failed', e);
  }
}

// ── First-time question ────────────────────────────────────────────────

/** True when I share a group with someone who has an account (only then can anyone notify me). */
function hasSharedGroup(): boolean {
  const me = getDeviceUserId();
  const mine = db
    .select({ groupId: members.groupId })
    .from(members)
    .where(and(eq(members.userId, me), isNull(members.deletedAt)))
    .all()
    .map((m) => m.groupId);
  if (mine.length === 0) return false;
  return mine.some(
    (groupId) =>
      db
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.groupId, groupId),
            isNotNull(members.userId),
            ne(members.userId, me),
            isNull(members.deletedAt),
          ),
        )
        .get() !== undefined,
  );
}

let asking = false;

/**
 * Once, after a sync shows I'm in a group with other account holders: explain, then ask Android.
 * Asking on first launch (before there's anything to be told about) mostly gets a "no".
 */
async function maybeAskOnce(): Promise<void> {
  if (asking || getSetting(appContext, NOTIFICATIONS_ASKED_KEY)) return;
  if ((await refreshPermission()) !== 'undetermined') return;
  if (!(await signedInUserId()) || !hasSharedGroup()) return;
  asking = true;
  setSetting(appContext, NOTIFICATIONS_ASKED_KEY, '1');
  Alert.alert(
    'Get notified?',
    'Know when friends add expenses or pay you back. Change it anytime in Account.',
    [
      { text: 'Not now', style: 'cancel', onPress: () => void (asking = false) },
      {
        text: 'Turn on',
        onPress: () => {
          asking = false;
          void requestPermission().then((granted) => {
            if (granted) {
              void syncPushRegistration();
              void refreshWeeklyReminder();
            }
          });
        },
      },
    ],
    { cancelable: true, onDismiss: () => void (asking = false) },
  );
}

// ── Opening a notification ─────────────────────────────────────────────

let lastHandled: string | null = null;

async function openFromNotification(id: string, data: unknown): Promise<void> {
  if (id === lastHandled) return;
  lastHandled = id;
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.type === 'settle') {
    router.push('/settle');
    return;
  }
  if (d.type !== 'group' || typeof d.groupId !== 'string' || !UUID.test(d.groupId)) return;
  const groupId = d.groupId.toLowerCase();
  // A push can arrive before this phone has the group or the expense: fetch first (max 5 s).
  if (!getGroup(db, groupId) || typeof d.expenseId === 'string') {
    await Promise.race([syncNow(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  if (!getGroup(db, groupId)) return;
  router.push({ pathname: '/groups/[groupId]', params: { groupId } });
}

async function ensureChannels(n: typeof import('expo-notifications')): Promise<void> {
  if (Platform.OS !== 'android') return;
  await n.setNotificationChannelAsync(ACTIVITY_CHANNEL, {
    name: 'Group activity',
    description: 'Expenses, payments and budgets in your groups',
    importance: n.AndroidImportance.DEFAULT,
  });
  await n.setNotificationChannelAsync(REMINDER_CHANNEL, {
    name: 'Reminders',
    description: 'Weekly settle-up reminder',
    importance: n.AndroidImportance.DEFAULT,
  });
}

// ── Start ──────────────────────────────────────────────────────────────

/** Call once from the root layout, after the database is ready. */
export function startNotifications(): () => void {
  const N = loadNotifications();
  if (!N) return () => undefined;

  const cleanups: (() => void)[] = [];
  let stopped = false;

  void N.then(async (n) => {
    if (stopped) return;
    n.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    const response = n.addNotificationResponseReceivedListener(
      (r) =>
        void openFromNotification(
          r.notification.request.identifier,
          r.notification.request.content.data,
        ),
    );
    const token = n.addPushTokenListener(() => void syncPushRegistration());
    cleanups.push(
      () => response.remove(),
      () => token.remove(),
    );

    try {
      await ensureChannels(n);
      // Cold start from a tap: the router mounts with the root layout, give it a moment.
      const last = await n.getLastNotificationResponseAsync();
      if (last) {
        setTimeout(
          () =>
            void openFromNotification(
              last.notification.request.identifier,
              last.notification.request.content.data,
            ),
          300,
        );
      }
    } catch (e) {
      devLog('start failed', e);
    }
    await refreshPermission();
    void refreshWeeklyReminder();
  });

  cleanups.push(
    onSyncSucceeded(() => {
      void syncPushRegistration();
      void refreshWeeklyReminder();
      void maybeAskOnce();
    }),
    onBeforeSignOut(forgetPushOnSignOut),
  );
  const appState = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    // The user may have changed the permission in Android settings meanwhile.
    void refreshPermission().then(() => {
      void syncPushRegistration();
      void refreshWeeklyReminder();
    });
  });
  cleanups.push(() => appState.remove());

  return () => {
    stopped = true;
    cleanups.forEach((cleanup) => cleanup());
  };
}
