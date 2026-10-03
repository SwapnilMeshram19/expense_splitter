import { requireOptionalNativeModule } from 'expo';

interface GoogleCredentialNative {
  signIn(webClientId: string, hashedNonce: string): Promise<string>;
  signOut(): Promise<void>;
}

// null in Expo Go and on iOS for now: callers hide the Google button instead of crashing.
const native = requireOptionalNativeModule<GoogleCredentialNative>('GoogleCredential');

export const isGoogleSignInAvailable = native !== null;

/** Shows Google's account chooser and resolves with an ID token whose nonce claim is hashedNonce. */
export async function getGoogleIdToken(webClientId: string, hashedNonce: string): Promise<string> {
  if (!native) {
    throw Object.assign(new Error('Google sign-in needs the development build'), { code: 'UNAVAILABLE' });
  }
  return native.signIn(webClientId, hashedNonce);
}

export async function clearGoogleCredential(): Promise<void> {
  await native?.signOut();
}