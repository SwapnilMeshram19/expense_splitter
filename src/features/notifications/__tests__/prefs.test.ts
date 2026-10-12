import { createTestContext, type TestContext } from '@/db/__tests__/testDb';

import {
  DEFAULT_NOTIFICATION_PREFS,
  getNotificationPrefs,
  needsRegistration,
  parseNotificationPrefs,
  parsePushRegistration,
  registrationSignature,
  REREGISTER_AFTER_MS,
  setNotificationPrefs,
  wantsPush,
} from '../prefs';
import { weeklyReminderText } from '../reminderText';

describe('notification prefs', () => {
  let t: TestContext;
  beforeEach(() => {
    t = createTestContext();
  });
  afterEach(() => t.close());

  it('defaults: push on, weekly reminder off', () => {
    expect(getNotificationPrefs(t.ctx)).toEqual({
      expenses: true,
      payments: true,
      budget: true,
      weekly: false,
    });
  });

  it('saves changes and keeps the rest', () => {
    setNotificationPrefs(t.ctx, { weekly: true });
    const next = setNotificationPrefs(t.ctx, { payments: false });
    expect(next).toEqual({ expenses: true, payments: false, budget: true, weekly: true });
    expect(getNotificationPrefs(t.ctx)).toEqual(next);
  });

  it('reads damaged or partial values safely', () => {
    expect(parseNotificationPrefs('{')).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs('null')).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(parseNotificationPrefs('{"budget":false,"weekly":"yes"}')).toEqual({
      ...DEFAULT_NOTIFICATION_PREFS,
      budget: false,
    });
  });

  it('knows when any push is wanted', () => {
    expect(wantsPush(DEFAULT_NOTIFICATION_PREFS)).toBe(true);
    expect(wantsPush({ expenses: false, payments: false, budget: false, weekly: true })).toBe(
      false,
    );
  });
});

describe('push registration', () => {
  const sig = registrationSignature('tok', 'user', DEFAULT_NOTIFICATION_PREFS, true);

  it('registers when anything changed, and refreshes weekly', () => {
    const now = 1_760_000_000_000;
    expect(needsRegistration(null, sig, now)).toBe(true);
    expect(needsRegistration({ token: 'tok', signature: sig, at: now - 1000 }, sig, now)).toBe(
      false,
    );
    expect(needsRegistration({ token: 'tok', signature: 'other', at: now }, sig, now)).toBe(true);
    expect(
      needsRegistration({ token: 'tok', signature: sig, at: now - REREGISTER_AFTER_MS }, sig, now),
    ).toBe(true);
    expect(needsRegistration({ token: 'tok', signature: sig, at: now + 60_000 }, sig, now)).toBe(
      true,
    ); // clock moved back
  });

  it('signature covers token, account, choices and number format', () => {
    expect(registrationSignature('tok', 'user', DEFAULT_NOTIFICATION_PREFS, false)).not.toBe(sig);
    expect(registrationSignature('tok', 'other', DEFAULT_NOTIFICATION_PREFS, true)).not.toBe(sig);
    expect(registrationSignature('tok2', 'user', DEFAULT_NOTIFICATION_PREFS, true)).not.toBe(sig);
    expect(
      registrationSignature('tok', 'user', { ...DEFAULT_NOTIFICATION_PREFS, weekly: true }, true),
    ).toBe(sig);
  });

  it('parses the stored registration', () => {
    expect(parsePushRegistration(JSON.stringify({ token: 'a', signature: 'b', at: 1 }))).toEqual({
      token: 'a',
      signature: 'b',
      at: 1,
    });
    expect(parsePushRegistration(null)).toBeNull();
    expect(parsePushRegistration('{"token":1}')).toBeNull();
    expect(parsePushRegistration('nope')).toBeNull();
  });
});

describe('weeklyReminderText', () => {
  const total = (currency: string, owedToMe: number, iOwe: number) => ({
    currency,
    owedToMe,
    iOwe,
    net: owedToMe - iOwe,
  });

  it('leads with what I owe, across currencies', () => {
    expect(weeklyReminderText([total('INR', 0, 125000), total('USD', 0, 2000)])).toEqual({
      title: 'Settle up this week?',
      body: 'You owe ₹1,250 + $20. Tap to see who to pay.',
    });
    expect(weeklyReminderText([total('INR', 300000, 0), total('USD', 0, 2000)])?.body).toBe(
      'You owe $20 and are owed ₹3,000. Tap to see who.',
    );
  });

  it('nudges when only owed, and says nothing when settled', () => {
    expect(weeklyReminderText([total('INR', 300000, 0)])).toEqual({
      title: 'Friends owe you money',
      body: 'You’re owed ₹3,000. Tap to send a reminder.',
    });
    expect(weeklyReminderText([])).toBeNull();
  });
});
