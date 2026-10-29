import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { createApi } from '@/api/client';
import { dataStore } from '@/data';
import { onReconnect } from '@/data/native';
import { syncOrigin } from '@/data/origin';
import { runLegacyHandover } from '@/legacy/handover';
import { getGoogleWebClientId } from '@/lib/env';
import { newId } from '@/lib/newId';
import { err, ok, type Result } from '@/lib/result';
import { getSupabase } from '@/lib/supabase';

import { clearGoogleCredential, getGoogleIdToken } from '../../../modules/google-credential';
import { describeAuthError, describeGoogleError, type AuthErrorLike } from './messages';
import { profileFromMetadata } from './profile';

/**
 * Who is using the app. Every install gets an account without being asked: an anonymous Supabase
 * user, created silently at first launch. "Save your account" (Google or email) turns it into a
 * permanent one with the same id, so nothing moves. If that Google account or email already has
 * an account, the app signs in to it and moves this phone's groups across (account.mergeAnonymous).
 */
export type AuthState =
  | { status: 'loading' }
  /** No account yet and no connection to make one (first launch offline). Saving still queues. */
  | { status: 'offline'; notice: string | null }
  | { status: 'anonymous'; userId: string; notice: string | null }
  | {
      status: 'signedIn';
      userId: string;
      email: string | null;
      /** From the identity provider (Google); null for email. Display only, never trusted. */
      displayName: string | null;
      /** https URL from the identity provider, validated before rendering (see Avatar). */
      avatarUrl: string | null;
    };

/** True when the app has an account to save to (anonymous or saved). */
export const hasAccount = (s: AuthState): s is Extract<AuthState, { userId: string }> =>
  s.status === 'anonymous' || s.status === 'signedIn';

let state: AuthState = { status: 'loading' };
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

export const getAuthState = (): AuthState => state;

/** Development-only diagnostics, printed in the Metro terminal. Never logs tokens. */
function devLog(label: string, e: unknown): void {
  if (!__DEV__) return;
  const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
  console.log(`[auth] ${label}`, { name: o.name, code: o.code, status: o.status, message: o.message });
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

let creating: Promise<void> | null = null;

/** Create the anonymous account if there is no session. Safe to call any time; never throws. */
export function ensureAccount(): Promise<void> {
  if (hasAccount(state)) return Promise.resolve();
  creating ??= (async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (data.session) return; // onAuthStateChange takes it from here
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        devLog('anonymous sign-in failed', error);
        emit({ status: 'offline', notice: describeAuthError(error) });
      }
    } catch (e) {
      devLog('anonymous sign-in threw', e);
      emit({ status: 'offline', notice: describeAuthError(toErrorLike(e)) });
    } finally {
      creating = null;
    }
  })();
  return creating;
}

function handleSession(session: Session | null): void {
  if (!session) {
    dataStore().setUser(null);
    emit({ status: 'loading' });
    // Deferred: never call supabase inside the auth callback (auth-js holds a lock).
    setTimeout(() => void ensureAccount(), 0);
    return;
  }

  const user = session.user;
  dataStore().setUser(user.id);
  if (user.is_anonymous) {
    emit({ status: 'anonymous', userId: user.id, notice });
  } else {
    notice = null;
    emit({
      status: 'signedIn',
      userId: user.id,
      email: user.email ?? null,
      ...profileFromMetadata(user.user_metadata),
    });
  }
  setTimeout(() => {
    void (async () => {
      // Builds before the server-first change kept data on the phone: upload it once.
      await runLegacyHandover(user.id).catch((e: unknown) => devLog('hand-over failed', e));
      await dataStore().flush();
      await dataStore().refreshAll();
    })();
  }, 0);
}

let started = false;

/** Call once at startup, after startData(). */
export function startAuth(): void {
  if (started) return;
  started = true;

  let supabase: SupabaseClient;
  try {
    supabase = getSupabase();
  } catch (e) {
    devLog('client failed to start', e);
    emit({ status: 'offline', notice: describeAuthError(toErrorLike(e)) });
    return;
  }

  supabase.auth.onAuthStateChange((_event, session) => handleSession(session));

  // Tokens refresh only in the foreground; a missing account is retried on return and reconnect.
  const onAppState = (appState: AppStateStatus) => {
    if (appState === 'active') {
      void supabase.auth.startAutoRefresh();
      if (!hasAccount(state)) void ensureAccount();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };
  onAppState(AppState.currentState);
  AppState.addEventListener('change', onAppState);
  onReconnect(() => {
    if (!hasAccount(state)) void ensureAccount();
  });
}

async function run(label: string, action: () => Promise<{ error: AuthError | null }>): Promise<Result<void, string>> {
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

// ── Saving the account ─────────────────────────────────────────────────

const ALREADY_USED = new Set(['identity_already_exists', 'email_exists', 'user_already_exists']);

/**
 * Move this phone's anonymous groups into the account just signed in to. Takes the anonymous
 * session's token from before the switch: it proves this device owned that user.
 */
async function mergeInto(anonymousAccessToken: string): Promise<Result<void, string>> {
  try {
    const [result] = await createApi(getSupabase).run(
      [{ requestId: newId(), op: 'account.mergeAnonymous', input: { anonymousAccessToken } }],
      syncOrigin(),
    );
    if (!result?.ok) {
      devLog('merge refused', result?.error);
      return err('Signed in, but your groups from this phone couldn’t be moved. Contact support.');
    }
    await dataStore().refreshAll();
    return ok(undefined);
  } catch (e) {
    devLog('merge failed', e);
    return err('Signed in, but your groups from this phone couldn’t be moved yet. Check your connection.');
  }
}

/** Queue first: changes made as the anonymous user must land before its groups move. */
async function anonymousTokenAfterFlush(): Promise<string | null> {
  await dataStore().flush();
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.is_anonymous ? data.session.access_token : null;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Save with Google: link it to this anonymous account, or (when that Google account already has
 * one here) sign in to it and bring this phone's groups along. err(null) = chooser dismissed.
 */
export async function saveWithGoogle(): Promise<Result<void, string | null>> {
  try {
    const supabase = getSupabase();
    const webClientId = getGoogleWebClientId();
    // Replay protection: Google embeds SHA-256(rawNonce) in the ID token; Supabase checks it.
    const rawNonce = toHex(Crypto.getRandomBytes(32));
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const idToken = await getGoogleIdToken(webClientId, hashedNonce);

    if (state.status !== 'anonymous') {
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce });
      return error ? err(describeAuthError(error)) : ok(undefined);
    }

    const linked = await supabase.auth.linkIdentity({ provider: 'google', token: idToken, nonce: rawNonce });
    if (!linked.error) {
      await supabase.auth.refreshSession();
      return ok(undefined);
    }
    if (!ALREADY_USED.has(linked.error.code ?? '')) return err(describeAuthError(linked.error));

    const anonToken = await anonymousTokenAfterFlush();
    if (!anonToken) return err('Something went wrong. Please try again.');
    const signedIn = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce });
    if (signedIn.error) return err(describeAuthError(signedIn.error));
    return mergeInto(anonToken);
  } catch (e) {
    devLog('saveWithGoogle threw', e);
    const errorLike = toErrorLike(e);
    if (errorLike.code === 'SIGN_IN_CANCELLED') return err(null);
    return err(describeGoogleError(errorLike.code) ?? describeAuthError(errorLike));
  }
}

/** Email in progress: 'link' adds it to this anonymous account; 'signIn' signs in to the existing one. */
let emailMode: { email: string; mode: 'link' | 'signIn' } | null = null;

/** Email a 6-digit code. Same answer whether or not the email has an account (no enumeration). */
export async function sendEmailCode(email: string): Promise<Result<void, string>> {
  notice = null;
  const supabase = getSupabase();
  if (state.status === 'anonymous') {
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (!error) {
        emailMode = { email, mode: 'link' };
        return ok(undefined);
      }
      // Already someone's account: sign in to it instead (this phone's groups move across).
      if (!ALREADY_USED.has(error.code ?? '')) {
        devLog('updateUser(email) returned an error', error);
        return err(describeAuthError(error));
      }
    } catch (e) {
      devLog('updateUser(email) threw', e);
      return err(describeAuthError(toErrorLike(e)));
    }
  }
  emailMode = { email, mode: 'signIn' };
  return run('signInWithOtp', () => supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
}

/** On success the auth listener switches the state to signedIn. */
export async function verifyEmailCode(email: string, code: string): Promise<Result<void, string>> {
  const supabase = getSupabase();
  if (emailMode?.email === email && emailMode.mode === 'link') {
    const result = await run('verifyOtp(email_change)', () => supabase.auth.verifyOtp({ email, token: code, type: 'email_change' }));
    if (result.ok) await supabase.auth.refreshSession().catch(() => undefined);
    return result;
  }
  const anonToken = state.status === 'anonymous' ? await anonymousTokenAfterFlush() : null;
  const result = await run('verifyOtp(email)', () => supabase.auth.verifyOtp({ email, token: code, type: 'email' }));
  if (!result.ok || !anonToken) return result;
  return mergeInto(anonToken);
}

// ── Signing out ────────────────────────────────────────────────────────

const beforeSignOut = new Set<() => Promise<void>>();

/**
 * Work that needs the session one last time (e.g. telling the server to stop sending push
 * notifications here). Each task gets at most 5 s; sign-out never waits longer or fails for one.
 */
export function onBeforeSignOut(task: () => Promise<void>): () => void {
  beforeSignOut.add(task);
  return () => {
    beforeSignOut.delete(task);
  };
}

/**
 * Saved accounts only (an anonymous one could never be signed back in to). The phone then starts
 * fresh with a new anonymous account; the groups stay in the saved account.
 */
export async function signOut(): Promise<Result<void, string>> {
  await Promise.all(
    [...beforeSignOut].map((task) =>
      Promise.race([
        task().catch((e: unknown) => devLog('before sign-out task failed', e)),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]),
    ),
  );
  const result = await run('signOut', () => getSupabase().auth.signOut({ scope: 'local' }));
  // Forget the chosen Google account so the next sign-in shows the chooser again.
  await clearGoogleCredential().catch(() => undefined);
  return result;
}
