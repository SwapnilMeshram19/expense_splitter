import type { ColorScheme } from './palette';

/**
 * Pure helpers for <Avatar>: no React, so they are unit-tested directly.
 */

/** "Swapnil Meshram" → "SM", "rahul" → "R", "  " → "?". Uses code points so ₹/Devanagari don't split mid-character. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const head = (word: string) => Array.from(word)[0]!.toLocaleUpperCase('en-IN');
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return last ? head(first) + head(last) : head(first);
}

/**
 * Background/foreground pairs, each ≥ 4.5:1 so initials stay readable. Cool blues, teals and
 * violets that sit with every accent; index order matters (CategoryTile picks by index).
 */
const SWATCHES: Record<ColorScheme, readonly { bg: string; fg: string }[]> = {
  light: [
    { bg: '#0A6AA1', fg: '#FFFFFF' }, // ocean
    { bg: '#4146C9', fg: '#FFFFFF' }, // indigo
    { bg: '#0E7C6B', fg: '#FFFFFF' }, // teal
    { bg: '#DCEFFB', fg: '#0B5A8A' }, // sky
    { bg: '#465364', fg: '#FFFFFF' }, // slate
    { bg: '#ECE9FD', fg: '#4338A8' }, // lavender
    { bg: '#7A3FB8', fg: '#FFFFFF' }, // violet
    { bg: '#DDF3EE', fg: '#0B5E52' }, // mint
  ],
  dark: [
    { bg: '#173A55', fg: '#A9D6F2' },
    { bg: '#272B66', fg: '#BDC1FA' },
    { bg: '#143D37', fg: '#8FDCCB' },
    { bg: '#1D3448', fg: '#BFE2F7' },
    { bg: '#2A3442', fg: '#D2DAE4' },
    { bg: '#2E2A55', fg: '#CFC9FB' },
    { bg: '#3A2457', fg: '#D9C2F5' },
    { bg: '#16332E', fg: '#A7E6D7' },
  ],
};

/** Stable colour per person: the same member id always gets the same swatch on every phone. */
export function avatarColors(seed: string, scheme: ColorScheme): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const swatches = SWATCHES[scheme];
  return swatches[hash % swatches.length]!;
}

export const AVATAR_SWATCHES = SWATCHES;

/** Only https photo URLs are rendered: never file://, content:// or plain http from account metadata. */
export function safePhotoUrl(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  // A regex, not new URL(): React Native's URL polyfill doesn't implement every getter.
  return /^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i.test(url) ? url : null;
}
