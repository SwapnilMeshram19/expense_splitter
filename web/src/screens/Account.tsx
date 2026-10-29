import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useDataStatus } from '@/data/hooks';
import {
  cleanOtp,
  isValidEmail,
  normalizeEmail,
  OTP_LENGTH,
  RESEND_COOLDOWN_S,
} from '@/features/auth/messages';
import { MAX_NAME_LENGTH } from '@/domain/names';

import { saveWithGoogle, sendEmailCode, signOut, useAuth, verifyEmailCode } from '../platform/auth';
import { googleClientId, renderGoogleButton } from '../platform/googleIdentity';
import { getSelfName, setSelfName } from '../platform/prefs';
import { useScreenOpen } from '../ui/hooks';
import { Card, ErrorText, Field, Spinner } from '../ui/kit';

function GoogleButton({ onDone }: { onDone: (error: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    renderGoogleButton(ref.current, (token, nonce) => {
      setBusy(true);
      void saveWithGoogle(token, nonce).then((r) => {
        setBusy(false);
        done.current(r.ok ? null : r.error);
      });
    }).catch(() => setFailed(true));
  }, []);
  if (failed)
    return (
      <p className="small muted">
        Google sign-in couldn’t load (offline or blocked). Use email instead.
      </p>
    );
  return (
    <>
      <div ref={ref} style={{ minHeight: 44 }} aria-busy={busy} />
      {busy ? <p className="small muted">Saving…</p> : null}
    </>
  );
}

function EmailSave({ onDone }: { onDone: (error: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    const result = await sendEmailCode(normalized);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSentTo(normalized);
    setCooldown(RESEND_COOLDOWN_S);
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!sentTo || code.length !== OTP_LENGTH)
      return setError(`Enter the ${OTP_LENGTH}-digit code from the email.`);
    setBusy(true);
    setError(null);
    const result = await verifyEmailCode(sentTo, code);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDone(null);
  };

  if (!sentTo) {
    return (
      <form className="stack" onSubmit={(e) => void send(e)}>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn secondary" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
    );
  }
  return (
    <form className="stack" onSubmit={(e) => void verify(e)}>
      <p className="small muted">
        We sent a {OTP_LENGTH}-digit code to {sentTo}.
      </p>
      <input
        className="input code"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(cleanOtp(e.target.value))}
        placeholder={'0'.repeat(OTP_LENGTH)}
        aria-label="Code from the email"
        autoFocus
      />
      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Checking…' : 'Confirm'}
      </button>
      <div className="row">
        <button
          type="button"
          className="btn ghost small"
          disabled={cooldown > 0 || busy}
          onClick={() => void send()}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
        <button type="button" className="btn ghost small" onClick={() => setSentTo(null)}>
          Change email
        </button>
      </div>
    </form>
  );
}

function YourName() {
  const [name, setName] = useState(getSelfName);
  const [saved, setSaved] = useState(false);
  return (
    <Field
      label="Your name for new groups"
      hint={saved ? 'Saved on this browser.' : 'Names inside existing groups don’t change.'}
    >
      <input
        className="input"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(e) => {
          setName(e.target.value);
          setSaved(false);
        }}
        onBlur={() => {
          setSelfName(name);
          setSaved(true);
        }}
      />
    </Field>
  );
}

export function AccountScreen() {
  useScreenOpen('Account');
  const auth = useAuth();
  const status = useDataStatus();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const done = (error: string | null) =>
    setMessage(error ? { error: true, text: error } : { error: false, text: 'Account saved.' });

  if (auth.status === 'loading') return <Spinner />;

  return (
    <>
      <h1>Account</h1>
      {message ? (
        message.error ? (
          <ErrorText>{message.text}</ErrorText>
        ) : (
          <div className="banner info">{message.text}</div>
        )
      ) : null}

      {auth.status === 'signedIn' ? (
        <Card>
          <h2>{auth.displayName ?? auth.email ?? 'Signed in'}</h2>
          {auth.email ? <p className="muted">{auth.email}</p> : null}
          <p className="small muted">
            Your groups are saved to this account. Sign in on any device to see them.
          </p>
          {status.queued > 0 ? (
            <p className="small warning">
              Some changes haven’t been sent yet. Connect to the internet before signing out.
            </p>
          ) : null}
          <button
            type="button"
            className="btn danger"
            disabled={signingOut || status.queued > 0}
            onClick={() => {
              setSigningOut(true);
              void signOut().then((r) => {
                if (!r.ok) {
                  setSigningOut(false);
                  setMessage({ error: true, text: r.error });
                }
              });
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out of this browser'}
          </button>
        </Card>
      ) : (
        <Card>
          <h2>{auth.status === 'anonymous' ? 'Save your account' : 'Sign in'}</h2>
          <p className="small muted">
            {auth.status === 'anonymous'
              ? 'Right now your groups live in this browser only. Save your account to keep them if the browser data is cleared, use them in the app, and invite people.'
              : 'Already use Expense Splitter? Sign in to see your groups. New here? You can start without an account.'}
          </p>
          {auth.status === 'offline' && auth.notice ? (
            <p className="small warning">{auth.notice}</p>
          ) : null}
          {googleClientId() ? <GoogleButton onDone={done} /> : null}
          <EmailSave onDone={done} />
        </Card>
      )}

      <Card>
        <YourName />
      </Card>

      <p className="small muted">
        Using a shared computer? Save your account and sign out when you’re done.{' '}
        <a href="/privacy/">Privacy</a>
      </p>
    </>
  );
}
