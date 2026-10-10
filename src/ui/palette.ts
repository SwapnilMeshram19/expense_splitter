/**
 * Colour tokens. Pure data (no React, no native imports) so tests can check contrast.
 *
 * Accents are user-selectable; everything else is fixed per scheme. "You're owed" amounts use
 * the accent (`positive === primary`), "you owe" uses a fixed rose in every accent; labels always
 * say which is which as well, so colour is never the only signal.
 *
 * Neutrals are cool (blue-grey) to sit with the blue-family accents; no orange anywhere except
 * the amber of warnings, which is a status colour, not decoration.
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
  /** Hero surfaces (balance card, centre + button): diagonal gradient, white content on top. */
  gradient: readonly [string, string];
}

export const ACCENTS: Record<AccentId, { label: string; light: AccentColors; dark: AccentColors }> = {
  ocean: {
    label: 'Ocean',
    light: {
      primary: '#0A6AA1',
      onPrimary: '#FFFFFF',
      primarySoft: '#E1EFF8',
      onPrimarySoft: '#08507A',
      gradient: ['#0B72B5', '#2E3FA6'],
    },
    dark: {
      primary: '#6CB8E6',
      onPrimary: '#06223A',
      primarySoft: '#16334A',
      onPrimarySoft: '#A9D6F2',
      gradient: ['#0F5C8E', '#26357F'],
    },
  },
  indigo: {
    label: 'Indigo',
    light: {
      primary: '#3A41C6',
      onPrimary: '#FFFFFF',
      primarySoft: '#E7E8FC',
      onPrimarySoft: '#2A2F94',
      gradient: ['#4B4FD8', '#6B2FB8'],
    },
    dark: {
      primary: '#8E95F2',
      onPrimary: '#12143A',
      primarySoft: '#252859',
      onPrimarySoft: '#B9BEF8',
      gradient: ['#3638A8', '#4F2590'],
    },
  },
  plum: {
    label: 'Plum',
    light: {
      primary: '#8A2D6E',
      onPrimary: '#FFFFFF',
      primarySoft: '#F6E7F1',
      onPrimarySoft: '#6B1F55',
      gradient: ['#9C2F7A', '#5E2A8A'],
    },
    dark: {
      primary: '#E39BCD',
      onPrimary: '#3A0F2E',
      primarySoft: '#3A1D33',
      onPrimarySoft: '#F0C3E2',
      gradient: ['#7A2461', '#47206B'],
    },
  },
  slate: {
    label: 'Slate',
    light: {
      primary: '#3A4553',
      onPrimary: '#FFFFFF',
      primarySoft: '#E7EBF0',
      onPrimarySoft: '#2A323D',
      gradient: ['#3E4C5E', '#1F2937'],
    },
    dark: {
      primary: '#A9B6C6',
      onPrimary: '#1A2029',
      primarySoft: '#262D37',
      onPrimarySoft: '#CED6E0',
      gradient: ['#334155', '#1E2532'],
    },
  },
  teal: {
    label: 'Teal',
    light: {
      primary: '#0E6B5C',
      onPrimary: '#FFFFFF',
      primarySoft: '#DDF1EC',
      onPrimarySoft: '#0A5246',
      gradient: ['#0D7466', '#0B5F86'],
    },
    dark: {
      primary: '#4FC3AE',
      onPrimary: '#0B1F1B',
      primarySoft: '#1E3A35',
      onPrimarySoft: '#7FD8C6',
      gradient: ['#0B6457', '#0B4A69'],
    },
  },
};

interface BaseColors {
  /** Screen background (cool off-white in light mode). */
  background: string;
  /** Cards, inputs, tab bar. */
  surface: string;
  /** Segmented controls, inset rows, disabled fills. */
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  /** "You owe" amounts and destructive actions. */
  negative: string;
  /** Warning text; on warningSoft or the screen background. */
  warning: string;
  warningSoft: string;
  /** Text on the hero gradient (always white: every gradient is dark enough for it). */
  onGradient: string;
}

const BASE: Record<ColorScheme, BaseColors> = {
  light: {
    background: '#F3F6FA',
    surface: '#FFFFFF',
    surfaceAlt: '#E9EEF5',
    text: '#121722',
    muted: '#5A6474',
    border: '#DCE3EC',
    negative: '#C63852',
    warning: '#8A5A00',
    warningSoft: '#FCEFD2',
    onGradient: '#FFFFFF',
  },
  dark: {
    background: '#0D1117',
    surface: '#161B22',
    surfaceAlt: '#1F2630',
    text: '#EDF1F6',
    muted: '#98A2B3',
    border: '#2A3340',
    negative: '#FFA3B1',
    warning: '#F5C76B',
    warningSoft: '#3A2E12',
    onGradient: '#FFFFFF',
  },
};

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
