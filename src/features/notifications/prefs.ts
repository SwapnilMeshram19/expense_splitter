import type { RepoContext } from '@/db/context';
import { getSetting, setSetting } from '@/db/repositories/profile';

/**
 * What this phone wants to be told about. Stored locally (settings table); the three push
 * choices are mirrored to the server with the phone's token (public.push_devices), because the
 * server decides whom to send to. The weekly reminder is scheduled on the phone only.
 */
export interface NotificationPrefs {
  /** Push: someone else added an expense I'm in (or a repeating one was added). */
  expenses: boolean;
  /** Push: a payment to or from me was recorded by someone else. */
  payments: boolean;
  /** Push: a group budget reached 80% / went over. */
  budget: boolean;
  /** Local: Sunday-evening settle-up reminder when I owe or am owed. */
  weekly: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  expenses: true,
  payments: true,
  budget: true,
  weekly: false,
};

export const NOTIFICATION_PREFS_KEY = 'notification_prefs';
export const PUSH_REGISTRATION_KEY = 'push_registration';
/** Set once the "get notified?" question has been shown, whatever the answer. */
export const NOTIFICATIONS_ASKED_KEY = 'notifications_asked';

/** Re-send an unchanged registration after this long, so the server's copy never goes stale. */
export const REREGISTER_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export function parseNotificationPrefs(raw: string | null): NotificationPrefs {
  if (!raw) return { ...DEFAULT_NOTIFICATION_PREFS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== 'object') return { ...DEFAULT_NOTIFICATION_PREFS };
    return {
      expenses: bool(o.expenses, DEFAULT_NOTIFICATION_PREFS.expenses),
      payments: bool(o.payments, DEFAULT_NOTIFICATION_PREFS.payments),
      budget: bool(o.budget, DEFAULT_NOTIFICATION_PREFS.budget),
      weekly: bool(o.weekly, DEFAULT_NOTIFICATION_PREFS.weekly),
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

export const getNotificationPrefs = (ctx: RepoContext): NotificationPrefs =>
  parseNotificationPrefs(getSetting(ctx, NOTIFICATION_PREFS_KEY));

export function setNotificationPrefs(
  ctx: RepoContext,
  patch: Partial<NotificationPrefs>,
): NotificationPrefs {
  const next = { ...getNotificationPrefs(ctx), ...patch };
  setSetting(ctx, NOTIFICATION_PREFS_KEY, JSON.stringify(next));
  return next;
}

export const wantsPush = (prefs: NotificationPrefs): boolean =>
  prefs.expenses || prefs.payments || prefs.budget;

/** What the server last accepted from this phone. */
export interface PushRegistration {
  token: string;
  signature: string;
  at: number;
}

export function parsePushRegistration(raw: string | null): PushRegistration | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<PushRegistration> | null;
    if (
      !o ||
      typeof o.token !== 'string' ||
      typeof o.signature !== 'string' ||
      typeof o.at !== 'number'
    )
      return null;
    return { token: o.token, signature: o.signature, at: o.at };
  } catch {
    return null;
  }
}

/** Everything the server copy depends on; a change means "register again". */
export function registrationSignature(
  token: string,
  userId: string,
  prefs: NotificationPrefs,
  indianGrouping: boolean,
): string {
  return JSON.stringify([
    token,
    userId,
    prefs.expenses,
    prefs.payments,
    prefs.budget,
    indianGrouping,
  ]);
}

export function needsRegistration(
  stored: PushRegistration | null,
  signature: string,
  now: number,
): boolean {
  return (
    !stored ||
    stored.signature !== signature ||
    now - stored.at >= REREGISTER_AFTER_MS ||
    now < stored.at
  );
}
