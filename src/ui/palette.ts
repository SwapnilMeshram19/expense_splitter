/**
 * Colour tokens. Pure data (no React, no native imports) so tests can check contrast.
 *
 * Accents are user-selectable; everything else is fixed per scheme. "You're owed" amounts use
 * the accent (`positive === primary`), "you owe" uses a fixed burnt orange in every accent so the
 * two never depend on hue alone; labels always say which is which as well.
 */

export type ColorScheme = 'light' | 'dark';

export const ACCENT_IDS = ['ocean', 'indigo', 'plum', 'slate', 'teal'] as const;
export type AccentId = (typeof ACCENT_IDS)[number];
export const DEFAULT_ACCENT: AccentId = 'ocean';

interface AccentColors {
  primary: string;
  onPrimary: string;
  /** Tinted background for selected pills, soft buttons and the active tab indicator. */
  primarySoft: string;
  /** Text/icon colour on primarySoft. */
  onPrimarySoft: string;
}

export const ACCENTS: Record<AccentId, { label: string; light: AccentColors; dark: AccentColors }> = {
  ocean: {
    label: 'Ocean',
    light: { primary: '#0A6AA1', onPrimary: '#FFFFFF', primarySoft: '#E1EFF7', onPrimarySoft: '#08507A' },
    dark: { primary: '#6CB8E6', onPrimary: '#06223A', primarySoft: '#16334A', onPrimarySoft: '#A9D6F2' },
  },
  indigo: {
    label: 'Indigo',
    light: { primary: '#3A41C6', onPrimary: '#FFFFFF', primarySoft: '#E5E7FB', onPrimarySoft: '#2A2F94' },
    dark: { primary: '#8E95F2', onPrimary: '#12143A', primarySoft: '#252859', onPrimarySoft: '#B9BEF8' },
  },
  plum: {
    label: 'Plum',
    light: { primary: '#8A2D6E', onPrimary: '#FFFFFF', primarySoft: '#F4E4EF', onPrimarySoft: '#6B1F55' },
    dark: { primary: '#E39BCD', onPrimary: '#3A0F2E', primarySoft: '#3A1D33', onPrimarySoft: '#F0C3E2' },
  },
  slate: {
    label: 'Slate',
    light: { primary: '#3A4553', onPrimary: '#FFFFFF', primarySoft: '#E6E9ED', onPrimarySoft: '#2A323D' },
    dark: { primary: '#A9B6C6', onPrimary: '#1A2029', primarySoft: '#262D37', onPrimarySoft: '#CED6E0' },
  },
  teal: {
    label: 'Teal',
    light: { primary: '#0E6B5C', onPrimary: '#FFFFFF', primarySoft: '#DDEFEA', onPrimarySoft: '#0A5246' },
    dark: { primary: '#4FC3AE', onPrimary: '#0B1F1B', primarySoft: '#1E3A35', onPrimarySoft: '#7FD8C6' },
  },
};

const BASE: Record<ColorScheme, BaseColors> = {
  light: {
    background: '#F6F5F1',
    surface: '#FFFFFF',
    surfaceAlt: '#EFEDE7',
    text: '#17181C',
    muted: '#5E6068',
    border: '#E3E0D8',
    negative: '#B8461B',
    warning: '#8A4B00',
    warningSoft: '#FBE7C6',
    highlight: '#F2A93B',
    onHighlight: '#17181C',
  },
  dark: {
    background: '#111214',
    surface: '#1A1B1F',
    surfaceAlt: '#23252A',
    text: '#F1EFEA',
    muted: '#A3A5AD',
    border: '#2E3036',
    negative: '#F08A5D',
    warning: '#F2C77E',
    warningSoft: '#3A2C14',
    highlight: '#F2A93B',
    onHighlight: '#17181C',
  },
};

interface BaseColors {
  /** Screen background (warm paper in light mode). */
  background: string;
  /** Cards, inputs, tab bar. */
  surface: string;
  /** Segmented controls, inset rows, disabled fills. */
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  negative: string;
  /** Warning text; on warningSoft or the screen background. */
  warning: string;
  warningSoft: string;
  /** Marigold call-to-action (Settle up). Same in both schemes, always with onHighlight text. */
  highlight: string;
  onHighlight: string;
}

export interface Theme extends BaseColors, AccentColors {
  scheme: ColorScheme;
  accent: AccentId;
  positive: string;
  /** Embedded at build time by the expo-font config plugin (app.json), weights 400–700. */
  fontFamily: string;
}

export const FONT_FAMILY = 'Poppins';

function build(scheme: ColorScheme, accent: AccentId): Theme {
  const accentColors = ACCENTS[accent][scheme];
  return Object.freeze({
    scheme,
    accent,
    ...BASE[scheme],
    ...accentColors,
    positive: accentColors.primary,
    fontFamily: FONT_FAMILY,
  });
}

// Precomputed and frozen: useTheme() returns the same object for the same inputs, so memoised
// components (React Compiler) don't re-render on every call.
const THEMES: Record<ColorScheme, Record<AccentId, Theme>> = {
  light: Object.fromEntries(ACCENT_IDS.map((a) => [a, build('light', a)])) as Record<AccentId, Theme>,
  dark: Object.fromEntries(ACCENT_IDS.map((a) => [a, build('dark', a)])) as Record<AccentId, Theme>,
};

export function getTheme(scheme: ColorScheme, accent: AccentId): Theme {
  return THEMES[scheme][accent];
}

export const isAccentId = (value: unknown): value is AccentId =>
  typeof value === 'string' && (ACCENT_IDS as readonly string[]).includes(value);

/** WCAG relative-luminance contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}
