import { createTestContext, type TestContext } from '@/db/__tests__/testDb';
import { getSetting } from '@/db/repositories/profile';

import { resolveScheme } from '../theme';
import {
  ACCENT_KEY,
  getThemePreference,
  loadThemePreference,
  parseThemePreference,
  resetThemePreferenceForTests,
  setAccent,
  setThemeMode,
  subscribeThemePreference,
  THEME_MODE_KEY,
} from '../themePreference';

let t: TestContext;

beforeEach(() => {
  t = createTestContext();
  resetThemePreferenceForTests();
});

afterEach(() => t.close());

describe('parseThemePreference', () => {
  it('falls back to System + Ocean for missing or unknown values', () => {
    expect(parseThemePreference(null, null)).toEqual({ mode: 'system', accent: 'ocean' });
    expect(parseThemePreference('sepia', 'green')).toEqual({ mode: 'system', accent: 'ocean' });
    expect(parseThemePreference('dark', 'plum')).toEqual({ mode: 'dark', accent: 'plum' });
  });
});

describe('theme preference store', () => {
  it('is not loaded until read from the DB', () => {
    expect(getThemePreference().loaded).toBe(false);
    expect(loadThemePreference(t.ctx)).toEqual({ mode: 'system', accent: 'ocean', loaded: true });
  });

  it('persists choices in the local settings table and notifies subscribers', () => {
    loadThemePreference(t.ctx);
    const seen: string[] = [];
    const unsubscribe = subscribeThemePreference((p) => seen.push(`${p.mode}/${p.accent}`));

    setThemeMode(t.ctx, 'dark');
    setAccent(t.ctx, 'indigo');
    setAccent(t.ctx, 'indigo'); // no-op: same value
    unsubscribe();
    setThemeMode(t.ctx, 'light');

    expect(seen).toEqual(['dark/ocean', 'dark/indigo']);
    expect(getSetting(t.ctx, THEME_MODE_KEY)).toBe('light');
    expect(getSetting(t.ctx, ACCENT_KEY)).toBe('indigo');

    resetThemePreferenceForTests();
    expect(loadThemePreference(t.ctx)).toEqual({ mode: 'light', accent: 'indigo', loaded: true });
  });

  it('returns a new snapshot object on every change (useSyncExternalStore compares identity)', () => {
    const before = loadThemePreference(t.ctx);
    setAccent(t.ctx, 'teal');
    expect(getThemePreference()).not.toBe(before);
    expect(Object.isFrozen(getThemePreference())).toBe(true);
  });
});

describe('resolveScheme', () => {
  it('follows the phone only in System mode', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });
});
