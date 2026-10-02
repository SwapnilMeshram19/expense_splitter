import { cleanOtp, describeAuthError, isValidEmail, normalizeEmail } from '../messages';

describe('describeAuthError', () => {
  it('detects network failures (no HTTP response)', () => {
    expect(describeAuthError({ name: 'AuthRetryableFetchError' })).toMatch(/internet/);
    expect(describeAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toMatch(/internet/);
    expect(describeAuthError({ status: 0 })).toMatch(/internet/);
  });

  it('treats retryable 5xx responses as server problems, not offline', () => {
    const text = describeAuthError({ name: 'AuthRetryableFetchError', status: 500 });
    expect(text).not.toMatch(/internet/);
    expect(text).toMatch(/try again in a few minutes/);
  });

  it('explains wrong or expired codes', () => {
    expect(describeAuthError({ code: 'otp_expired', status: 403 })).toMatch(/wrong or has expired/);
  });

  it('maps rate limits with or without a code', () => {
    expect(describeAuthError({ code: 'over_email_send_rate_limit' })).toMatch(/Too many codes/);
    expect(describeAuthError({ status: 429 })).toMatch(/Too many attempts/);
  });

  it('reports missing configuration', () => {
    expect(describeAuthError({ name: 'MissingConfigError' })).toMatch(/isn’t set up/);
  });

  it('falls back to generic text and never echoes server details', () => {
    expect(describeAuthError({ code: 'unexpected_failure', status: 400 })).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('email and code input', () => {
  it('normalizes and validates email', () => {
    expect(normalizeEmail('  Asha.P@Gmail.COM ')).toBe('asha.p@gmail.com');
    expect(isValidEmail('asha.p@gmail.com')).toBe(true);
    expect(isValidEmail('asha@gmail')).toBe(false);
    expect(isValidEmail('asha @gmail.com')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@x.in`)).toBe(false);
  });

  it('keeps only the first six digits of a pasted code', () => {
    expect(cleanOtp(' 12 34-56 789')).toBe('123456');
    expect(cleanOtp('abc')).toBe('');
  });
});