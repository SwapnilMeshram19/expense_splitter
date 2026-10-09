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

/** Background/foreground pairs, each ≥ 4.5:1 so initials stay readable. */
const SWATCHES: Record<ColorScheme, readonly { bg: string; fg: string }[]> = {
  light: [
    { bg: '#0A6AA1', fg: '#FFFFFF' },
    { bg: '#F2A93B', fg: '#17181C' },
    { bg: '#8A2D6E', fg: '#FFFFFF' },
    { bg: '#E1EFF7', fg: '#08507A' },
    { bg: '#3A4553', fg: '#FFFFFF' },
    { bg: '#F4E4EF', fg: '#6B1F55' },
    { bg: '#9A4A12', fg: '#FFFFFF' },
    { bg: '#E5E7FB', fg: '#2A2F94' },
  ],
  dark: [
    { bg: '#16334A', fg: '#A9D6F2' },
    { bg: '#F2A93B', fg: '#17181C' },
    { bg: '#3A1D33', fg: '#F0C3E2' },
    { bg: '#252859', fg: '#B9BEF8' },
    { bg: '#262D37', fg: '#CED6E0' },
    { bg: '#3A2C14', fg: '#F2C77E' },
    { bg: '#1E3A35', fg: '#7FD8C6' },
    { bg: '#2E3036', fg: '#F1EFEA' },
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
