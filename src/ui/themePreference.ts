import { useSyncExternalStore } from 'react';

import type { RepoContext } from '@/db/context';
import { getSetting, setSetting } from '@/db/repositories/profile';

import { DEFAULT_ACCENT, isAccentId, type AccentId } from './palette';

/**
 * Appearance preference: a device setting, stored in the local-only `settings` table and never
 * synced (two phones of one account may well want different themes).
 *
 * Kept in a tiny external store rather than read through useLiveData so the theme is available
 * before the DB is ready (the migration/loading screen renders with the defaults) and switching
 * theme doesn't depend on SQLite change events.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export interface ThemePreference {
  mode: ThemeMode;
  accent: AccentId;
}

export const THEME_MODE_KEY = 'ui_theme_mode';
export const ACCENT_KEY = 'ui_accent';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = Object.freeze({
  mode: 'system',
  accent: DEFAULT_ACCENT,
});

export interface ThemePreferenceState extends ThemePreference {
  /** False until loadThemePreference() has read the saved values from the DB. */
  loaded: boolean;
}

const isThemeMode = (value: unknown): value is ThemeMode =>
  typeof value === 'string' && (THEME_MODES as readonly string[]).includes(value);

/** Unknown or corrupted values (older/newer app versions) fall back to the defaults. */
export function parseThemePreference(mode: string | null, accent: string | null): ThemePreference {
  return {
    mode: isThemeMode(mode) ? mode : DEFAULT_THEME_PREFERENCE.mode,
    accent: isAccentId(accent) ? accent : DEFAULT_THEME_PREFERENCE.accent,
  };
}

let current: ThemePreferenceState = Object.freeze({ ...DEFAULT_THEME_PREFERENCE, loaded: false });
const listeners = new Set<(pref: ThemePreferenceState) => void>();

function emit(next: ThemePreferenceState): void {
  if (next.mode === current.mode && next.accent === current.accent && next.loaded === current.loaded) return;
  // A new frozen object per change: useSyncExternalStore compares snapshots by identity.
  current = Object.freeze({ ...next });
  listeners.forEach((notify) => notify(current));
}

/** Read the saved preference. Call once the migrations have created the settings table. */
export function loadThemePreference(ctx: RepoContext): ThemePreferenceState {
  const saved = parseThemePreference(getSetting(ctx, THEME_MODE_KEY), getSetting(ctx, ACCENT_KEY));
  emit({ ...saved, loaded: true });
  return current;
}

export function setThemeMode(ctx: RepoContext, mode: ThemeMode): void {
  setSetting(ctx, THEME_MODE_KEY, mode);
  emit({ ...current, mode });
}

export function setAccent(ctx: RepoContext, accent: AccentId): void {
  setSetting(ctx, ACCENT_KEY, accent);
  emit({ ...current, accent });
}

export const getThemePreference = (): ThemePreferenceState => current;

/** Non-React subscribers (e.g. syncing the native colour scheme). Returns an unsubscribe. */
export function subscribeThemePreference(notify: (pref: ThemePreferenceState) => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useThemePreference(): ThemePreferenceState {
  return useSyncExternalStore(subscribeThemePreference, getThemePreference);
}

/** Test-only: back to the not-loaded defaults. */
export function resetThemePreferenceForTests(): void {
  current = Object.freeze({ ...DEFAULT_THEME_PREFERENCE, loaded: false });
}
