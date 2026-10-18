import Constants from 'expo-constants';

export type AppVariant = 'development' | 'production';

/**
 * Which build this is, as set by APP_VARIANT in app.config.ts (embedded in the native build; served by
 * Metro in a dev client). Unknown values read as production: this is only used for labels, never to
 * pick a backend.
 */
export function getAppVariant(): AppVariant {
  return Constants.expoConfig?.extra?.appVariant === 'development' ? 'development' : 'production';
}
