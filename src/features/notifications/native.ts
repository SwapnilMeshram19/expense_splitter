import { requireOptionalNativeModule } from 'expo';

type NotificationsModule = typeof import('expo-notifications');

/**
 * expo-notifications is a native module: an APK built before it was added doesn't have it, and
 * importing it there throws at startup. Everything goes through loadNotifications(), which
 * imports it only when the native side is present.
 */
export const notificationsInstalled = (): boolean =>
  requireOptionalNativeModule('ExpoNotificationPresenter') !== null &&
  requireOptionalNativeModule('ExpoNotificationPermissionsModule') !== null &&
  requireOptionalNativeModule('ExpoPushTokenManager') !== null;

let loaded: Promise<NotificationsModule> | null = null;

export function loadNotifications(): Promise<NotificationsModule> | null {
  if (!notificationsInstalled()) return null;
  loaded ??= import('expo-notifications');
  return loaded;
}
