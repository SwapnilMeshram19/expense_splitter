import { Appearance, useColorScheme } from 'react-native';

import type { Tone } from '@/features/balances/describe';

import { getTheme, type ColorScheme, type Theme } from './palette';
import { useThemePreference, type ThemeMode } from './themePreference';

export type { Theme } from './palette';

/**
 * The active theme: the saved mode (System/Light/Dark) and accent, resolved against the phone's
 * setting when the mode is System. Same signature as before the redesign, so every screen that
 * calls useTheme() picks up the new palette without changes.
 */
export function useTheme(): Theme {
  const system = useColorScheme();
  const { mode, accent } = useThemePreference();
  return getTheme(resolveScheme(mode, system), accent);
}

export function resolveScheme(mode: ThemeMode, system: string | null | undefined): ColorScheme {
  if (mode === 'light' || mode === 'dark') return mode;
  return system === 'dark' ? 'dark' : 'light';
}

/**
 * Make native UI (Alert dialogs, the date picker, the keyboard) follow an explicit Light/Dark
 * choice instead of the phone's setting. 'unspecified' hands control back to the system.
 */
export function applyNativeColorScheme(mode: ThemeMode): void {
  Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
}

export function toneColor(theme: Theme, tone: Tone): string {
  return tone === 'positive' ? theme.positive : tone === 'negative' ? theme.negative : theme.muted;
}
