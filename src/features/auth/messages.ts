export const OTP_LENGTH = 6; // must match Auth → Providers → Email → OTP length
export const RESEND_COOLDOWN_S = 60; // Supabase's minimum interval between OTP emails

const MAX_EMAIL_LENGTH = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

export const isValidEmail = (email: string): boolean =>
  email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);

/** Keep digits only (pasted codes often contain spaces or dashes), capped at OTP_LENGTH. */
export const cleanOtp = (raw: string): string => raw.replace(/\D/g, '').slice(0, OTP_LENGTH);

export interface AuthErrorLike {
  code?: string;
  status?: number;
  name?: string;
}

/**
 * True only when no HTTP response arrived. supabase-js also names 5xx responses
 * AuthRetryableFetchError, so the name alone does not mean "offline".
 */
function isNetworkFailure(e: AuthErrorLike): boolean {
  if (e.status === 0) return true;
  return e.name === 'AuthRetryableFetchError' && e.status === undefined;
}

/** User-facing text for auth failures. Never shows the raw server message. */
export function describeAuthError(e: AuthErrorLike): string {
  if (e.name === 'MissingConfigError') return 'Sign-in isn’t set up in this build yet.';
  if (isNetworkFailure(e)) return 'No internet connection. Check your network and try again.';

  switch (e.code) {
    case 'otp_expired':
      return 'That code is wrong or has expired. Check the latest email, or request a new code.';
    case 'over_email_send_rate_limit':
      return 'Too many codes sent. Wait a minute, then try again.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a few minutes, then try again.';
    case 'email_address_invalid':
      return 'That email address doesn’t look right.';
    case 'email_address_not_authorized':
      return 'We can’t send email to this address yet. Please try again later.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'Email sign-in is turned off right now. Please try again later.';
  }

  if (e.status === 429) return 'Too many attempts. Wait a few minutes, then try again.';
  if (e.status !== undefined && e.status >= 500) {
    return 'We couldn’t complete that right now. Please try again in a few minutes.';
  }
  return 'Something went wrong. Please try again.';
}