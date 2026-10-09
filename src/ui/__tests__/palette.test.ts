import { AVATAR_SWATCHES } from '../avatarColors';
import { ACCENT_IDS, contrastRatio, getTheme, isAccentId, type ColorScheme } from '../palette';

const SCHEMES: ColorScheme[] = ['light', 'dark'];
const AA_TEXT = 4.5;

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });
});

// Guards every future palette tweak: each text/background pair the screens use must stay readable.
describe.each(SCHEMES)('%s theme', (scheme) => {
  describe.each([...ACCENT_IDS])('accent %s', (accent) => {
    const t = getTheme(scheme, accent);
    const pairs: [string, string, string][] = [
      ['text on background', t.text, t.background],
      ['text on surface', t.text, t.surface],
      ['text on surfaceAlt', t.text, t.surfaceAlt],
      ['muted on background', t.muted, t.background],
      ['muted on surface', t.muted, t.surface],
      ['onPrimary on primary', t.onPrimary, t.primary],
      ['onPrimarySoft on primarySoft', t.onPrimarySoft, t.primarySoft],
      ['positive amount on surface', t.positive, t.surface],
      ['negative amount on surface', t.negative, t.surface],
      ['warning on warningSoft', t.warning, t.warningSoft],
      ['onHighlight on highlight', t.onHighlight, t.highlight],
    ];

    it.each(pairs)('%s is at least 4.5:1', (_label, fg, bg) => {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it('owed and owe amounts differ in lightness, not just hue', () => {
      // Lightness gap keeps them apart for colour-blind users (labels say it too).
      expect(contrastRatio(t.positive, t.negative)).toBeGreaterThan(1.05);
    });
  });
});

describe('avatar swatches', () => {
  it.each(SCHEMES)('initials are readable on every %s swatch', (scheme) => {
    for (const { bg, fg } of AVATAR_SWATCHES[scheme]) {
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('getTheme', () => {
  it('returns the same frozen object for the same inputs', () => {
    const a = getTheme('light', 'ocean');
    expect(getTheme('light', 'ocean')).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.positive).toBe(a.primary);
  });

  it('uses Ocean as the first and default accent', () => {
    expect(ACCENT_IDS[0]).toBe('ocean');
  });

  it('recognises accent ids only', () => {
    expect(isAccentId('plum')).toBe(true);
    expect(isAccentId('green')).toBe(false);
    expect(isAccentId(null)).toBe(false);
  });
});
