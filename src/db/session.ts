import { appContext } from './appContext';
import { getOrCreateDeviceUserId } from './repositories/profile';

let deviceUserId: string | null = null;

/** Device user id, read once and cached for the app session. */
export function getDeviceUserId(): string {
  deviceUserId ??= getOrCreateDeviceUserId(appContext);
  return deviceUserId;
}