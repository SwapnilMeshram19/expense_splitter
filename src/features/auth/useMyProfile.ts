import { appContext } from '@/db/appContext';
import { useLiveData } from '@/db/hooks/useLiveData';
import { getSetting, SELF_NAME_KEY } from '@/db/repositories/profile';

import { useAuth } from './authStore';

export interface MyProfile {
  /** Seed for the avatar colour: the account id (a fixed placeholder before it exists). */
  id: string;
  name: string | null;
  email: string | null;
  photoUrl: string | null;
  /** Saved with Google or email (not only the anonymous account every install gets). */
  signedIn: boolean;
}

const TABLES = ['settings'];
const loadSelfName = () => getSetting(appContext, SELF_NAME_KEY);

/**
 * Who "me" is, for the header avatar and the Account tab. The account's display name wins
 * (Google), then the name typed when creating the first group, then the email's local part.
 */
export function useMyProfile(): MyProfile {
  const auth = useAuth();
  const selfName = useLiveData(TABLES, loadSelfName);

  if (auth.status !== 'signedIn') {
    const id = auth.status === 'anonymous' ? auth.userId : 'me';
    return { id, name: selfName, email: null, photoUrl: null, signedIn: false };
  }
  const emailName = auth.email ? (auth.email.split('@')[0] ?? null) : null;
  return {
    id: auth.userId,
    name: auth.displayName ?? selfName ?? emailName,
    email: auth.email,
    photoUrl: auth.avatarUrl,
    signedIn: true,
  };
}
