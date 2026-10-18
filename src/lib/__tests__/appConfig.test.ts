import {
  ADMOB_TEST_APP_IDS,
  buildConfig,
  resolveAdMobAppIds,
  resolveVariant,
  VARIANTS,
} from '../../../app.config';

describe('resolveVariant', () => {
  it('defaults to development when unset or blank, so nothing builds against production by accident', () => {
    expect(resolveVariant(undefined)).toBe('development');
    expect(resolveVariant('')).toBe('development');
    expect(resolveVariant('  ')).toBe('development');
  });

  it('accepts the two variants', () => {
    expect(resolveVariant('development')).toBe('development');
    expect(resolveVariant(' production ')).toBe('production');
  });

  it('rejects typos instead of falling back', () => {
    expect(() => resolveVariant('prod')).toThrow(/APP_VARIANT/);
    expect(() => resolveVariant('Production')).toThrow(/APP_VARIANT/);
  });
});

describe('buildConfig', () => {
  it('keeps the Play Store identity for production', () => {
    const config = buildConfig('production');
    expect(config.name).toBe('Expense Splitter');
    expect(config.android?.package).toBe('in.ssoftapp.split');
    expect(config.ios?.bundleIdentifier).toBe('in.ssoftapp.split');
    expect(config.scheme).toBe('expensesplitter');
    expect(config.android?.adaptiveIcon?.backgroundImage).toBe(
      './assets/images/android-icon-background.png',
    );
    expect(config.extra?.appVariant).toBe('production');
  });

  it('gives development its own package, scheme, label and icon colour', () => {
    const config = buildConfig('development');
    expect(config.name).toBe('Split Dev');
    expect(config.android?.package).toBe('in.ssoftapp.split.dev');
    expect(config.ios?.bundleIdentifier).toBe('in.ssoftapp.split.dev');
    expect(config.scheme).toBe('expensesplitter-dev');
    expect(config.android?.adaptiveIcon?.backgroundImage).toBeUndefined();
    expect(config.android?.adaptiveIcon?.backgroundColor).toBe('#B45309');
    expect(config.extra?.appVariant).toBe('development');
  });

  it('never shares an identifier or scheme between variants', () => {
    expect(VARIANTS.development.id).not.toBe(VARIANTS.production.id);
    expect(VARIANTS.development.scheme).not.toBe(VARIANTS.production.scheme);
  });

  it('adds the Firebase file only when it exists', () => {
    expect(buildConfig('development').android?.googleServicesFile).toBeUndefined();
    expect(
      buildConfig('development', { googleServicesFile: './google-services.json' }).android
        ?.googleServicesFile,
    ).toBe('./google-services.json');
  });

  it('keeps native config identical across variants apart from identity', () => {
    const dev = buildConfig('development');
    const prod = buildConfig('production');
    expect(dev.plugins).toEqual(prod.plugins);
    expect(dev.android?.intentFilters).toEqual(prod.android?.intentFilters);
    expect(dev.ios?.infoPlist).toEqual(prod.ios?.infoPlist);
    expect(prod.plugins).toContain('./plugins/with-upi-queries');
  });
});

describe('fonts', () => {
  it('embeds the subset Inter files on both platforms', () => {
    const fontPlugin = buildConfig('production').plugins?.find(
      (
        p,
      ): p is [
        string,
        {
          android: { fonts: { fontFamily: string; fontDefinitions: { path: string }[] }[] };
          ios: { fonts: string[] };
        },
      ] => Array.isArray(p) && p[0] === 'expo-font',
    );
    expect(fontPlugin).toBeDefined();
    const [, options] = fontPlugin!;
    expect(options.android.fonts[0]!.fontFamily).toBe('Inter');
    expect(options.android.fonts[0]!.fontDefinitions.map((d) => d.path)).toEqual(options.ios.fonts);
    expect(options.ios.fonts.every((path) => path.startsWith('./assets/fonts/Inter-'))).toBe(true);
  });
});

describe('resolveAdMobAppIds', () => {
  const REAL = 'ca-app-pub-1234567890123456~1234567890';

  it('always uses the test app IDs in development', () => {
    expect(resolveAdMobAppIds('development', { android: REAL })).toEqual(ADMOB_TEST_APP_IDS);
  });

  it('requires a real Android app ID in production', () => {
    expect(() => resolveAdMobAppIds('production', {})).toThrow(/ADMOB_ANDROID_APP_ID/);
    // A unit ID (slash) pasted where the app ID (tilde) belongs.
    expect(() =>
      resolveAdMobAppIds('production', { android: 'ca-app-pub-1234567890123456/1234567890' }),
    ).toThrow(/ADMOB_ANDROID_APP_ID/);
  });

  it('uses the real Android ID and falls back to the iOS test ID until iOS ships', () => {
    expect(resolveAdMobAppIds('production', { android: ` ${REAL} ` })).toEqual({
      android: REAL,
      ios: ADMOB_TEST_APP_IDS.ios,
    });
  });

  it('passes the IDs to the ads config plugin with the low-end-friendly flags', () => {
    const ids = { android: REAL, ios: ADMOB_TEST_APP_IDS.ios };
    const plugin = buildConfig('production', { admob: ids }).plugins?.find(
      (p) => Array.isArray(p) && p[0] === 'react-native-google-mobile-ads',
    );
    expect(plugin).toEqual([
      'react-native-google-mobile-ads',
      {
        androidAppId: REAL,
        iosAppId: ADMOB_TEST_APP_IDS.ios,
        delayAppMeasurementInit: true,
        optimizeInitialization: true,
        optimizeAdLoading: true,
      },
    ]);
  });
});
