import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { appContext } from '@/db/appContext';
import { linkAccount, type LinkAccountError } from '@/db/repositories/identity';
import { clearDeviceUserIdCache } from '@/db/session';
import { getGoogleWebClientId } from '@/lib/env';
import { err, ok, type Result } from '@/lib/result';
import { getSupabase } from '@/lib/supabase';

import { clearGoogleCredential, getGoogleIdToken } from '../../../modules/google-credential';
import { describeAuthError, describeGoogleError, type AuthErrorLike } from './messages';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice: string | null }
  | { status: 'signedIn'; userId: string; email: string | null };

let state: AuthState = { status: 'loading' };
/** Explanation shown on the sign-in screen (e.g. why a sign-in was refused). */
let notice: string | null = null;
const listeners = new Set<() => void>();

function emit(next: AuthState): void {
  state = next;
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

const getState = () => state;

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getState);
}

/** Development-only diagnostics, printed in the Metro terminal. Never logs tokens; release builds log nothing. */
function devLog(label: string, e: unknown): void {
  if (!__DEV__) return;
  const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
  // console.log, not warn: expected failures (wrong code, rate limit) shouldn't pop LogBox.
  console.log(`[auth] ${label}`, {
    name: o.name,
    code: o.code,
    status: o.status,
    message: o.message,
  });
}

const LINK_NOTICES: Record<LinkAccountError['code'], string> = {
  OTHER_ACCOUNT_LINKED:
    'The groups on this phone belong to a different account. Sign in with that account to use them.',
  INVALID_USER_ID: 'Sign-in returned an unexpected account. Please try again.',
};

function handleSession(session: Session | null, signOutLocally: () => void): void {
  if (!session) {
    emit({ status: 'signedOut', notice });
    return;
  }

  const linked = linkAccount(appContext, session.user.id);
  if (!linked.ok) {
    devLog('link refused', linked.error);
    notice = LINK_NOTICES[linked.error.code];
    emit({ status: 'signedOut', notice });
    signOutLocally();
    return;
  }

  clearDeviceUserIdCache();
  notice = null;
  emit({ status: 'signedIn', userId: session.user.id, email: session.user.email ?? null });
}

let started = false;

/** Call once, after local DB migrations succeed (linking writes to SQLite). */
export function startAuth(): void {
  if (started) return;
  started = true;

  let supabase: SupabaseClient;
  try {
    supabase = getSupabase();
  } catch (e) {
    devLog('client failed to start', e);
    notice = describeAuthError(toErrorLike(e));
    emit({ status: 'signedOut', notice });
    return;
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    // auth-js holds a lock while this callback runs: awaiting a supabase call here deadlocks.
    handleSession(session, () => {
      setTimeout(() => {
        void supabase.auth.signOut({ scope: 'local' });
        void clearGoogleCredential().catch(() => undefined);
      }, 0);
    });
  });

  // Refresh tokens only while the app is in the foreground.
  const syncRefresh = (appState: AppStateStatus) => {
    if (appState === 'active') void supabase.auth.startAutoRefresh();
    else void supabase.auth.stopAutoRefresh();
  };
  syncRefresh(AppState.currentState);
  AppState.addEventListener('change', syncRefresh);
}

function clearNotice(): void {
  if (notice === null) return;
  notice = null;
  if (state.status === 'signedOut') emit({ status: 'signedOut', notice: null });
}

function toErrorLike(e: unknown): AuthErrorLike {
  if (!e || typeof e !== 'object') return {};
  const o = e as Record<string, unknown>;
  return {
    code: typeof o.code === 'string' ? o.code : undefined,
    status: typeof o.status === 'number' ? o.status : undefined,
    name: typeof o.name === 'string' ? o.name : undefined,
  };
}

async function run(
  label: string,
  action: () => Promise<{ error: AuthError | null }>,
): Promise<Result<void, string>> {
  try {
    const { error } = await action();
    if (error) {
      devLog(`${label} returned an error`, error);
      return err(describeAuthError(error));
    }
    return ok(undefined);
  } catch (e) {
    devLog(`${label} threw`, e);
    return err(describeAuthError(toErrorLike(e)));
  }
}

/** Email an OTP code. Same response for new and existing emails (no account enumeration). */
export function sendEmailCode(email: string): Promise<Result<void, string>> {
  clearNotice();
  return run('sendEmailCode', () =>
    getSupabase().auth.signInWithOtp({ email, options: { shouldCreateUser: true } }),
  );
}

/** On success, onAuthStateChange links the account and flips the state to signedIn. */
export function verifyEmailCode(email: string, code: string): Promise<Result<void, string>> {
  return run('verifyEmailCode', () =>
    getSupabase().auth.verifyOtp({ email, token: code, type: 'email' }),
  );
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Native Google sign-in with replay protection: Google embeds SHA-256(rawNonce) in the ID token,
 * Supabase recomputes it from rawNonce, which never leaves this device except to Supabase.
 * Resolves err(null) when the user simply dismissed the chooser.
 */
export async function signInWithGoogle(): Promise<Result<void, string | null>> {
  clearNotice();
  try {
    const webClientId = getGoogleWebClientId();
    const rawNonce = toHex(Crypto.getRandomBytes(32));
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

    const idToken = await getGoogleIdToken(webClientId, hashedNonce);
    const { error } = await getSupabase().auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
      nonce: rawNonce,
    });
    if (error) {
      devLog('signInWithGoogle returned an error', error);
      return err(describeAuthError(error));
    }
    return ok(undefined);
  } catch (e) {
    devLog('signInWithGoogle threw', e);
    const errorLike = toErrorLike(e);
    if (errorLike.code === 'SIGN_IN_CANCELLED') return err(null);
    return err(describeGoogleError(errorLike.code) ?? describeAuthError(errorLike));
  }
}

/** This phone only, works offline. Local groups and the account binding are kept. */
export async function signOut(): Promise<Result<void, string>> {
  const result = await run('signOut', () => getSupabase().auth.signOut({ scope: 'local' }));
  // Forget the chosen Google account so the next sign-in shows the chooser again.
  await clearGoogleCredential().catch(() => undefined);
  return result;
}