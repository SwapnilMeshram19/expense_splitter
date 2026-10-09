import { appContext } from '@/db/appContext';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getSetting, SELF_NAME_KEY } from '@/db/repositories/profile';
import { getDeviceUserId } from '@/db/session';

import { useAuth } from './authStore';

export interface MyProfile {
  /** Seed for the avatar colour: the local "me" id (the account id once signed in). */
  id: string;
  name: string | null;
  email: string | null;
  photoUrl: string | null;
  signedIn: boolean;
}

const TABLES = ['settings'];
const loadSelfName = () => ({ selfName: getSetting(appContext, SELF_NAME_KEY), id: getDeviceUserId() });

/**
 * Who "me" is, for the header avatar and the Account tab. The account's display name wins
 * (Google), then the name typed when creating the first group, then the email's local part.
 */
export function useMyProfile(): MyProfile {
  const auth = useAuth();
  const local = useLiveData(TABLES, loadSelfName);

  if (auth.status !== 'signedIn') {
    return { id: local.id, name: local.selfName, email: null, photoUrl: null, signedIn: false };
  }
  const emailName = auth.email ? (auth.email.split('@')[0] ?? null) : null;
  return {
    id: auth.userId,
    name: auth.displayName ?? local.selfName ?? emailName,
    email: auth.email,
    photoUrl: auth.avatarUrl,
    signedIn: true,
  };
}
