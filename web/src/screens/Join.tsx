/**
 * Invite links land here: https://expense-splitter.ssoftapp.in/join/?code=ABCD-EFGH (what the app shares)
 * or /join/ABCD-EFGH.
 *
 * With the app installed and the domain verified (assetlinks.json), Android opens the app before
 * this page loads. Otherwise: "Open in the app" (an intent link that falls back to the Play Store)
 * or join right here in the browser with an anonymous account, no sign-up.
 *
 * The code leaves the address bar once read (history.replaceState), so it isn't left in the
 * browser history of a shared computer; Referrer-Policy: no-referrer keeps it out of Referer.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';

import { dataStore } from '@/data';
import { joinGroup, previewInvite, type InvitePreview } from '@/features/invites/inviteApi';
import {
  describeInviteStatus,
  extractInviteCode,
  formatInviteCode,
} from '@/features/invites/messages';
import { MAX_NAME_LENGTH } from '@/domain/names';

import { requireAccount, useAuth } from '../platform/auth';
import { getSelfName, setSelfName } from '../platform/prefs';
import { useScreenOpen } from '../ui/hooks';
import { Card, ErrorText, Spinner } from '../ui/kit';

const APP_PACKAGE = 'in.ssoftapp.split';
const playStoreUrl = (): string =>
  import.meta.env.VITE_PLAY_STORE_URL ||
  `https://play.google.com/store/apps/details?id=${APP_PACKAGE}`;

/** Android Chrome: open the app on this link if installed, else the Play Store. */
function appIntentUrl(code: string): string {
  const fallback = encodeURIComponent(playStoreUrl());
  return `intent://expense-splitter.ssoftapp.in/join/?code=${formatInviteCode(code)}#Intent;scheme=https;package=${APP_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

const isAndroid = () => /Android/i.test(navigator.userAgent);

type Phase =
  | { kind: 'checking' }
  | { kind: 'preview'; preview: InvitePreview; notice: string | null }
  | { kind: 'joining' }
  | { kind: 'error'; message: string };

export function JoinScreen({ pathCode }: { pathCode?: string }) {
  useScreenOpen('Join a group');
  const search = useSearch();
  const [initial] = useState(() =>
    extractInviteCode(pathCode ?? new URLSearchParams(search).get('code') ?? ''),
  );
  const [code, setCode] = useState<string | null>(initial);

  useEffect(() => {
    if (initial) window.history.replaceState(null, '', '/join');
  }, [initial]);

  if (!code) return <EnterCode onCode={setCode} />;
  return <JoinWithCode code={code} onReset={() => setCode(null)} />;
}

function EnterCode({ onCode }: { onCode: (code: string) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const code = extractInviteCode(text);
        if (code) onCode(code);
        else setError('Not an invite code. It looks like ABCD-EFGH.');
      }}
    >
      <Card>
        <h1>Join a group</h1>
        <p className="muted">Paste the invite link or enter the code.</p>
        <input
          className="input code"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="Invite code or link"
          autoFocus
        />
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn block">
          Continue
        </button>
      </Card>
    </form>
  );
}

function JoinWithCode({ code, onReset }: { code: string; onReset: () => void }) {
  const auth = useAuth();
  const [, navigate] = useLocation();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [reload, setReload] = useState(0);

  const openGroup = async (groupId: string) => {
    setPhase({ kind: 'joining' });
    await dataStore().refreshGroup(groupId);
    if (dataStore().group(groupId)) navigate(`/groups/${groupId}`, { replace: true });
    else
      setPhase({
        kind: 'error',
        message: 'You’ve joined! The group appears once you’re back online.',
      });
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Checking an invite needs an account (the server rate-limits wrong codes per user).
      if (!(await requireAccount())) {
        if (!cancelled) setPhase({ kind: 'error', message: describeInviteStatus('OFFLINE') });
        return;
      }
      const result = await previewInvite(code);
      if (cancelled) return;
      if (result.ok) {
        setPhase({
          kind: 'preview',
          preview: result.value,
          notice: reload > 0 ? describeInviteStatus('ALREADY_CLAIMED') : null,
        });
      } else if (result.error.status === 'ALREADY_MEMBER' && result.error.groupId) {
        await openGroup(result.error.groupId);
      } else {
        setPhase({ kind: 'error', message: describeInviteStatus(result.error.status) });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, reload]);

  const appButton = isAndroid() ? (
    <a className="btn secondary block" href={appIntentUrl(code)}>
      Open in the app
    </a>
  ) : null;

  if (auth.status === 'loading' || phase.kind === 'checking')
    return <Spinner label="Checking the invite…" />;
  if (phase.kind === 'joining') return <Spinner label="Joining…" />;
  if (phase.kind === 'error') {
    return (
      <Card>
        <p>{phase.message}</p>
        <p className="code muted">{formatInviteCode(code)}</p>
        <button type="button" className="btn block" onClick={onReset}>
          Enter a different code
        </button>
        <Link href="/" className="btn ghost block">
          Go to my groups
        </Link>
      </Card>
    );
  }

  return (
    <>
      {appButton}
      <ChooseWho
        code={code}
        preview={phase.preview}
        notice={phase.notice}
        onJoined={(groupId) => void openGroup(groupId)}
        onClaimTaken={() => {
          setPhase({ kind: 'checking' });
          setReload((n) => n + 1);
        }}
        onError={(message) => setPhase({ kind: 'error', message })}
      />
    </>
  );
}

function ChooseWho({
  code,
  preview,
  notice,
  onJoined,
  onClaimTaken,
  onError,
}: {
  code: string;
  preview: InvitePreview;
  notice: string | null;
  onJoined: (groupId: string) => void;
  onClaimTaken: () => void;
  onError: (message: string) => void;
}) {
  const [choice, setChoice] = useState<string>(preview.placeholders.length > 0 ? '' : 'new');
  const [name, setName] = useState(getSelfName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (!choice) return setError('Choose who you are.');
    if (choice === 'new' && name.trim() === '') return setError('Enter your name.');
    setBusy(true);
    setError(null);
    const result = await joinGroup(
      code,
      choice === 'new' ? null : choice,
      choice === 'new' ? name.trim() : null,
    );
    setBusy(false);
    if (result.ok) {
      if (choice === 'new') setSelfName(name);
      return onJoined(result.value.groupId);
    }
    if (result.error.status === 'ALREADY_CLAIMED' || result.error.status === 'UNKNOWN_MEMBER')
      return onClaimTaken();
    onError(describeInviteStatus(result.error.status));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void join();
      }}
    >
      <Card>
        <h1>Join “{preview.groupName}”</h1>
        <p className="muted">
          {preview.memberCount} {preview.memberCount === 1 ? 'person' : 'people'}
        </p>
        {notice ? <div className="banner warn">{notice}</div> : null}
        <h2>Who are you?</h2>
        <div role="radiogroup" aria-label="Who are you?">
          {preview.placeholders.map((p) => (
            <label key={p.id} className="check-row">
              <input
                type="radio"
                name="who"
                checked={choice === p.id}
                onChange={() => setChoice(p.id)}
              />
              <span className="grow">
                {p.displayName}
                <br />
                <span className="small muted">Keeps their expenses</span>
              </span>
            </label>
          ))}
          <label className="check-row">
            <input
              type="radio"
              name="who"
              checked={choice === 'new'}
              onChange={() => setChoice('new')}
            />
            <span className="grow">I’m new here</span>
          </label>
        </div>
        {choice === 'new' ? (
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={MAX_NAME_LENGTH}
            aria-label="Your name"
            autoComplete="given-name"
          />
        ) : null}
        <ErrorText>{error}</ErrorText>
        <button type="submit" className="btn block" disabled={busy}>
          {busy ? 'Joining…' : 'Join group'}
        </button>
        <p className="small muted">
          No sign-up needed. You can save your account later to keep it on other devices.
        </p>
      </Card>
    </form>
  );
}
