import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';

import { runCommand } from '@/data/hooks';
import {
  currencyLabel,
  DEFAULT_CURRENCY,
  POPULAR_CURRENCIES,
  CURRENCIES,
  type CurrencyCode,
} from '@/domain/currency';
import { MAX_NAME_LENGTH } from '@/domain/names';
import { describeGroupError } from '@/features/groups/messages';
import { newId } from '@/lib/newId';

import { ensureAccount } from '../platform/auth';
import { getSelfName, setSelfName } from '../platform/prefs';
import { useScreenOpen } from '../ui/hooks';
import { Card, ErrorText, Field } from '../ui/kit';

const OTHER_CURRENCIES = CURRENCIES.map((c) => c.code).filter(
  (c) => !POPULAR_CURRENCIES.includes(c),
);

export function NewGroupScreen() {
  useScreenOpen('New group');
  const [, navigate] = useLocation();
  const [name, setName] = useState('');
  const [myName, setMyName] = useState(getSelfName);
  const [people, setPeople] = useState<{ key: string; name: string }[]>([
    { key: newId(), name: '' },
  ]);
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setPerson = (key: string, value: string) => {
    setPeople((list) => {
      const next = list.map((p) => (p.key === key ? { ...p, name: value } : p));
      // Always one empty row at the end to type the next name into.
      return next.at(-1)?.name.trim() ? [...next, { key: newId(), name: '' }] : next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (myName.trim() === '') return setError('Enter your name.');
    setSaving(true);
    setError(null);
    // Makes the anonymous account if this is the first thing the visitor does. Offline it can't,
    // and the group waits in the queue until it can.
    await ensureAccount();
    const groupId = newId();
    const result = await runCommand('group.create', {
      id: groupId,
      name,
      myMemberId: newId(),
      myName: myName.trim(),
      members: people
        .filter((p) => p.name.trim() !== '')
        .map((p) => ({ id: newId(), name: p.name })),
      currency,
    });
    setSaving(false);
    if (!result.ok) return setError(describeGroupError(result.error));
    setSelfName(myName);
    navigate(`/groups/${groupId}`, { replace: true });
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="narrow">
      <h1>New group</h1>
      <Card>
        <Field label="Group name">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Goa trip, Flat 302…"
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            required
          />
        </Field>
        <Field label="Your name">
          <input
            className="input"
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            placeholder="Shown to others in the group"
            maxLength={MAX_NAME_LENGTH}
            autoComplete="given-name"
          />
        </Field>
        <Field
          label="Currency"
          hint="Fixed once the group has expenses. Bills in other currencies are converted."
        >
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <optgroup label="Popular">
              {POPULAR_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {currencyLabel(c)}
                </option>
              ))}
            </optgroup>
            <optgroup label="All">
              {OTHER_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {currencyLabel(c)}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
      </Card>

      <Card>
        <h2>People</h2>
        <p className="small muted">
          Add names now; they can join later with an invite link and take over their name.
        </p>
        {people.map((p, i) => (
          <input
            key={p.key}
            className="input"
            value={p.name}
            onChange={(e) => setPerson(p.key, e.target.value)}
            placeholder={i === 0 ? 'Name' : 'Another name'}
            maxLength={MAX_NAME_LENGTH}
            aria-label={`Person ${i + 1}`}
          />
        ))}
      </Card>

      <ErrorText>{error}</ErrorText>
      <button type="submit" className="btn block" disabled={saving}>
        {saving ? 'Creating…' : 'Create group'}
      </button>
    </form>
  );
}
