import { appContext } from './appContext';
import { getOrCreateDeviceUserId } from './repositories/profile';

let deviceUserId: string | null = null;

/**
 * The local "me" id, cached for the app session: a random device id until the first
 * sign-in, the account's user id afterwards.
 */
export function getDeviceUserId(): string {
  deviceUserId ??= getOrCreateDeviceUserId(appContext);
  return deviceUserId;
}

/** Call after linkAccount() so the next read picks up the account id. */
export function clearDeviceUserIdCache(): void {
  deviceUserId = null;
}