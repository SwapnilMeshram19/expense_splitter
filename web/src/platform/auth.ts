/**
 * Accounts on the web: the same model as the app (src/features/auth/authStore.ts).
 *
 * - A visitor has no account until they do something that needs one (create or join a group).
 *   Then an anonymous Supabase user is made silently. Opening the site alone creates nothing, so
 *   link previews and crawlers don't add accounts (they count toward the 50k MAU free limit).
 * - "Save your account" links Google (ID token from GIS) or an email (6-digit code) to the same
 *   user id. If that Google account / email already has an account, we sign in to it and move
 *   this browser's groups across with account.mergeAnonymous.
 * - Sign-out (saved accounts only) wipes this browser's cache, for shared computers.
 */
import type { AuthError, Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';

import { createApi } from '@/api/client';
import { dataStore } from '@/data';
import { syncOrigin } from '@/data/origin';
import { describeAuthError, type AuthErrorLike } from '@/features/auth/messages';
import { profileFromMetadata } from '@/features/auth/profile';
import { err, ok, type Result } from '@/lib/result';
import { getSupabase } from '@/lib/supabase';
import { newId } from '@/lib/newId';

import { onReconnect } from './data';
import { forgetGoogleChoice } from './googleIdentity';
import { clearLocalPrefs } from './prefs';
import { wipeWebPersistence } from './persistence';

export type AuthState =
  | { status: 'loading' }
  /** No account yet: nothing has needed one. */
  | { status: 'visitor' }
  /** An account is needed but couldn't be made (offline, rate limit). */
  | { status: 'offline'; notice: string | null }
  | { status: 'anonymous'; userId: string }
  | { status: 'signedIn'; userId: string; email: string | null; displayName: string | null };

export const hasAccount = (s: AuthState): s is Extract<AuthState, { userId: string }> =>
  s.status === 'anonymous' || s.status === 'signedIn';

let state: AuthState = { status: 'loading' };
const listeners = new Set<() => void>();

function emit(next: AuthState): void {
  state = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getState = () => state;

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getState);
}

export const getAuthState = (): AuthState => state;

function toErrorLike(e: unknown): AuthErrorLike {
  if (!e || typeof e !== 'object') return {};
  const o = e as Record<string, unknown>;
  return {
    code: typeof o.code === 'string' ? o.code : undefined,
    status: typeof o.status === 'number' ? o.status : undefined,
    name: typeof o.name === 'string' ? o.name : undefined,
  };
}

/** Resolves when onAuthStateChange has reported the session just created. */
let sessionArrived: (() => void) | null = null;
let creating: Promise<void> | null = null;

/**
 * Make sure there's an account (anonymous if needed). Resolves once the store knows the user, or
 * with state 'offline' when it couldn't be made. Never throws.
 */
export function ensureAccount(): Promise<void> {
  if (hasAccount(state)) return Promise.resolve();
  creating ??= (async () => {
    try {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (data.session) return handleSession(data.session);
      const arrived = new Promise<void>((resolve) => (sessionArrived = resolve));
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        sessionArrived = null;
        // A server setting, not the visitor's problem: a plain message for them, the fix for us.
        const disabled = error.code === 'anonymous_provider_disabled';
        if (disabled && import.meta.env.DEV) {
          console.warn(
            '[web] Anonymous sign-ins are off: Supabase → Authentication → Sign In / Providers.',
          );
        }
        const notice = disabled
          ? 'New accounts can’t be created right now. Please try again later.'
          : describeAuthError(error);
        emit({ status: 'offline', notice });
        return;
      }
      await arrived;
    } catch (e) {
      emit({ status: 'offline', notice: describeAuthError(toErrorLike(e)) });
    } finally {
      creating = null;
    }
  })();
  return creating;
}

/** For actions that need an account: makes one if needed; false when that failed. */
export async function requireAccount(): Promise<boolean> {
  await ensureAccount();
  return hasAccount(state);
}

let lastUserId: string | null = null;

function handleSession(session: Session | null): void {
  if (!session) {
    dataStore().setUser(null);
    lastUserId = null;
    emit({ status: 'visitor' });
    // A group created before the first account (offline) waits in the queue: make the account.
    if (dataStore().pendingOps().length > 0) setTimeout(() => void ensureAccount(), 0);
    return;
  }
  const user = session.user;
  dataStore().setUser(user.id);
  if (user.is_anonymous) {
    emit({ status: 'anonymous', userId: user.id });
  } else {
    const profile = profileFromMetadata(user.user_metadata);
    emit({
      status: 'signedIn',
      userId: user.id,
      email: user.email ?? null,
      displayName: profile.displayName,
    });
  }
  sessionArrived?.();
  sessionArrived = null;
  // Token refreshes also land here: only a new user needs the queue sent and groups fetched.
  if (user.id === lastUserId) return;
  lastUserId = user.id;
  setTimeout(() => {
    void (async () => {
      await dataStore().flush();
      await dataStore().refreshAll();
    })();
  }, 0);
}

let started = false;

/** Call once at start-up, after startData(). */
export function startAuth(): void {
  if (started) return;
  started = true;
  let supabase;
  try {
    supabase = getSupabase();
  } catch (e) {
    emit({ status: 'offline', notice: describeAuthError(toErrorLike(e)) });
    return;
  }
  // Deferred: never call supabase inside the auth callback (auth-js holds a lock).
  supabase.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));

  // Something queued before the first account (created a group offline): make the account when
  // the connection comes back, so it can be sent.
  onReconnect(() => {
    if (!hasAccount(state) && dataStore().pendingOps().length > 0) void ensureAccount();
  });
}

async function run(
  action: () => Promise<{ error: AuthError | null }>,
): Promise<Result<void, string>> {
  try {
    const { error } = await action();
    return error ? err(describeAuthError(error)) : ok(undefined);
  } catch (e) {
    return err(describeAuthError(toErrorLike(e)));
  }
}

// ── Saving the account ─────────────────────────────────────────────────

const ALREADY_USED = new Set(['identity_already_exists', 'email_exists', 'user_already_exists']);

/** Move this browser's anonymous groups into the account just signed in to. */
async function mergeInto(anonymousAccessToken: string): Promise<Result<void, string>> {
  try {
    const [result] = await createApi(getSupabase).run(
      [{ requestId: newId(), op: 'account.mergeAnonymous', input: { anonymousAccessToken } }],
      syncOrigin(),
    );
    if (!result?.ok)
      return err(
        'Signed in, but your groups from this browser couldn’t be moved. Contact support@ssoftapp.in.',
      );
    await dataStore().refreshAll();
    return ok(undefined);
  } catch {
    return err(
      'Signed in, but your groups from this browser couldn’t be moved yet. Check your connection and sign in again.',
    );
  }
}

/** Queue first: changes made as the anonymous user must land before its groups move. */
async function anonymousTokenAfterFlush(): Promise<string | null> {
  await dataStore().flush();
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.is_anonymous ? data.session.access_token : null;
}

/** Google ID token from the GIS button: link it, or sign in to its existing account and merge. */
export async function saveWithGoogle(
  idToken: string,
  rawNonce: string,
): Promise<Result<void, string>> {
  try {
    const supabase = getSupabase();
    const credentials = { provider: 'google' as const, token: idToken, nonce: rawNonce };
    if (state.status !== 'anonymous') {
      return run(() => supabase.auth.signInWithIdToken(credentials));
    }
    const linked = await supabase.auth.linkIdentity(credentials);
    if (!linked.error) {
      await supabase.auth.refreshSession();
      return ok(undefined);
    }
    if (!ALREADY_USED.has(linked.error.code ?? '')) return err(describeAuthError(linked.error));

    const anonToken = await anonymousTokenAfterFlush();
    if (!anonToken) return err('Something went wrong. Please try again.');
    const signedIn = await supabase.auth.signInWithIdToken(credentials);
    if (signedIn.error) return err(describeAuthError(signedIn.error));
    return mergeInto(anonToken);
  } catch (e) {
    return err(describeAuthError(toErrorLike(e)));
  }
}

let emailMode: { email: string; mode: 'link' | 'signIn' } | null = null;

/** Email a 6-digit code. Same answer whether or not the email has an account (no enumeration). */
export async function sendEmailCode(email: string): Promise<Result<void, string>> {
  const supabase = getSupabase();
  // A visitor (no account yet) signs in or up directly: no throwaway anonymous user in between.
  if (state.status === 'anonymous') {
    try {
      const { error } = await supabase.auth.updateUser({ email });
      if (!error) {
        emailMode = { email, mode: 'link' };
        return ok(undefined);
      }
      if (!ALREADY_USED.has(error.code ?? '')) return err(describeAuthError(error));
    } catch (e) {
      return err(describeAuthError(toErrorLike(e)));
    }
  }
  emailMode = { email, mode: 'signIn' };
  return run(() => supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
}

export async function verifyEmailCode(email: string, code: string): Promise<Result<void, string>> {
  const supabase = getSupabase();
  if (emailMode?.email === email && emailMode.mode === 'link') {
    const result = await run(() =>
      supabase.auth.verifyOtp({ email, token: code, type: 'email_change' }),
    );
    if (result.ok) await supabase.auth.refreshSession().catch(() => undefined);
    return result;
  }
  const anonToken = state.status === 'anonymous' ? await anonymousTokenAfterFlush() : null;
  const result = await run(() => supabase.auth.verifyOtp({ email, token: code, type: 'email' }));
  if (!result.ok || !anonToken) return result;
  return mergeInto(anonToken);
}

/**
 * Saved accounts only. Clears this browser completely (cache, queue, name) and reloads, so the
 * next person on a shared computer starts as a visitor.
 */
export async function signOut(): Promise<Result<void, string>> {
  const result = await run(() => getSupabase().auth.signOut({ scope: 'local' }));
  if (!result.ok) return result;
  forgetGoogleChoice();
  clearLocalPrefs();
  await wipeWebPersistence();
  window.location.replace('/');
  return result;
}
