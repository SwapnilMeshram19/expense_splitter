import { buildConfig, resolveVariant, VARIANTS } from '../../../app.config';

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
