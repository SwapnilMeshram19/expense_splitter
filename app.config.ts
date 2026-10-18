/**
 * Expo app config: the single source of truth (app.json is gone).
 *
 * Two variants, picked by APP_VARIANT at config time (prebuild, `expo start`, CI):
 * - development (default): package in.ssoftapp.split.dev, "Split Dev", orange icon. Installs next to
 *   the Play Store app, has its own local SQLite and talks to the dev Supabase project.
 * - production: package in.ssoftapp.split. Only the release workflow sets APP_VARIANT=production.
 *
 * AdMob: development always uses Google's test app ID (no risk of invalid-traffic flags while
 * testing). Production needs ADMOB_ANDROID_APP_ID at build time; the ad unit IDs are EXPO_PUBLIC_*
 * values read in src/features/ads/adUnits.ts.
 *
 * Supabase URL/key and the Google web client ID are NOT here: they're EXPO_PUBLIC_* values read in
 * src/lib/env.ts, and Expo picks them from .env.development* / .env.production* by build mode.
 *
 * Version: APP_VERSION_NAME / APP_VERSION_CODE, set by the release workflow from its inputs. Unset →
 * Expo's defaults (package.json version, versionCode 1), which is what dev builds want.
 *
 * Keep this file free of app imports: Node evaluates it, the app bundle never includes it.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ExpoConfig } from 'expo/config';

export type AppVariant = 'development' | 'production';

interface VariantSettings {
  /** Launcher label. Short: small phones truncate after ~12 characters. */
  name: string;
  /** Android package and iOS bundle identifier. Never change production's: it's the Play listing. */
  id: string;
  scheme: string;
  /** Adaptive-icon background. Development uses a flat orange so the two icons can't be mixed up. */
  iconBackground: string;
  iconBackgroundImage?: string;
}

export const VARIANTS: Record<AppVariant, VariantSettings> = {
  production: {
    name: 'Expense Splitter',
    id: 'in.ssoftapp.split',
    scheme: 'expensesplitter',
    iconBackground: '#1C5AAE',
    iconBackgroundImage: './assets/images/android-icon-background.png',
  },
  development: {
    name: 'Split Dev',
    id: 'in.ssoftapp.split.dev',
    scheme: 'expensesplitter-dev',
    iconBackground: '#B45309',
  },
};

/**
 * Unset → development, so a forgotten variable can never produce a build that writes to production.
 * A typo ("prod") fails loudly instead of silently falling back.
 */
export function resolveVariant(raw: string | undefined): AppVariant {
  const value = raw?.trim();
  if (!value) return 'development';
  if (value === 'development' || value === 'production') return value;
  throw new Error(`APP_VARIANT must be "development" or "production", got "${value}".`);
}

/** Subset Inter (Latin, punctuation, ₹/currency, ≈): see scripts/subset-inter.sh. */
const INTER_WEIGHTS = [
  { weight: 400, path: './assets/fonts/Inter-Regular.ttf' },
  { weight: 500, path: './assets/fonts/Inter-Medium.ttf' },
  { weight: 600, path: './assets/fonts/Inter-SemiBold.ttf' },
  { weight: 700, path: './assets/fonts/Inter-Bold.ttf' },
] as const;

/** Google's published sample AdMob app IDs: always serve test ads, never earn, never get flagged. */
export const ADMOB_TEST_APP_IDS = {
  android: 'ca-app-pub-3940256099942544~3347511713',
  ios: 'ca-app-pub-3940256099942544~1458002511',
} as const;

const ADMOB_APP_ID = /^ca-app-pub-\d{16}~\d{10}$/;

export interface AdMobAppIds {
  android: string;
  ios: string;
}

/**
 * Development: test IDs, always (whatever the env says). Production: the real Android app ID is
 * required, so a release can't ship with the test ID and silently earn nothing. iOS isn't shipped
 * yet, so it falls back to the test ID until ADMOB_IOS_APP_ID exists.
 */
export function resolveAdMobAppIds(
  variant: AppVariant,
  env: { android?: string; ios?: string },
): AdMobAppIds {
  if (variant === 'development') return { ...ADMOB_TEST_APP_IDS };
  const android = env.android?.trim();
  if (!android || !ADMOB_APP_ID.test(android)) {
    throw new Error(
      'Production build needs ADMOB_ANDROID_APP_ID (AdMob → Apps → App settings, ' +
        'like ca-app-pub-1234567890123456~1234567890).',
    );
  }
  const ios = env.ios?.trim();
  return { android, ios: ios && ADMOB_APP_ID.test(ios) ? ios : ADMOB_TEST_APP_IDS.ios };
}

export interface AppVersion {
  /** versionName users see, like 1.2.3. */
  name?: string;
  /** Android versionCode: must grow with every upload to Play. */
  code?: number;
}

/** Play rejects versionCode above 2100000000. */
export const MAX_VERSION_CODE = 2_100_000_000;

/**
 * Both optional (dev builds, `npm run config:prod`); when set they must be valid, so a bad workflow
 * input fails at config time rather than as a Play upload error after a 30-minute build.
 */
export function resolveAppVersion(env: { name?: string; code?: string }): AppVersion {
  const version: AppVersion = {};
  const name = env.name?.trim();
  if (name) {
    if (!/^\d+\.\d+\.\d+$/.test(name)) {
      throw new Error(`APP_VERSION_NAME must look like 1.2.3, got "${name}".`);
    }
    version.name = name;
  }
  const code = env.code?.trim();
  if (code) {
    const n = Number(code);
    if (!/^[1-9]\d*$/.test(code) || n > MAX_VERSION_CODE) {
      throw new Error(
        `APP_VERSION_CODE must be a whole number from 1 to ${MAX_VERSION_CODE}, got "${code}".`,
      );
    }
    version.code = n;
  }
  return version;
}

interface BuildOptions {
  /** Firebase config for push. Missing → the app builds and works, just without push. */
  googleServicesFile?: string;
  /** Defaults to the test IDs (tests, config inspection). appConfig() always passes real ones. */
  admob?: AdMobAppIds;
  version?: AppVersion;
}

export function buildConfig(variant: AppVariant, options: BuildOptions = {}): ExpoConfig {
  const v = VARIANTS[variant];
  const admob = options.admob ?? ADMOB_TEST_APP_IDS;
  const version = options.version ?? {};

  return {
    name: v.name,
    slug: 'expense-splitter',
    ...(version.name ? { version: version.name } : {}),
    scheme: v.scheme,
    icon: './assets/images/icon.png',
    platforms: ['android', 'ios'],
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: v.id,
      infoPlist: {
        LSApplicationQueriesSchemes: ['upi', 'whatsapp'],
      },
    },
    android: {
      package: v.id,
      ...(version.code ? { versionCode: version.code } : {}),
      adaptiveIcon: {
        foregroundImage: './assets/images/android-icon-foreground.png',
        ...(v.iconBackgroundImage ? { backgroundImage: v.iconBackgroundImage } : {}),
        monochromeImage: './assets/images/android-icon-monochrome.png',
        backgroundColor: v.iconBackground,
      },
      ...(options.googleServicesFile ? { googleServicesFile: options.googleServicesFile } : {}),
      // Same filter in both variants so invite links can be tested on the dev app. Verification
      // (autoVerify) only succeeds for packages listed in split.ssoftapp.in/.well-known/assetlinks.json.
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host: 'split.ssoftapp.in', pathPrefix: '/join' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
    plugins: [
      'expo-sqlite',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 160,
          resizeMode: 'contain',
          backgroundColor: '#1C5AAE',
        },
      ],
      [
        'expo-font',
        {
          android: {
            fonts: [
              {
                fontFamily: 'Inter',
                fontDefinitions: INTER_WEIGHTS.map(({ weight, path: fontPath }) => ({
                  path: fontPath,
                  weight,
                })),
              },
            ],
          },
          ios: {
            fonts: INTER_WEIGHTS.map(({ path: fontPath }) => fontPath),
          },
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-icon.png',
          color: '#0A6AA1',
          defaultChannel: 'activity',
        },
      ],
      '@react-native-community/datetimepicker',
      'expo-secure-store',
      './plugins/with-upi-queries',
      [
        'expo-image-picker',
        {
          cameraPermission: 'Expense Splitter uses the camera to take a photo of a receipt.',
          photosPermission: 'Expense Splitter lets you attach a receipt photo from your gallery.',
          microphonePermission: false,
        },
      ],
      [
        'react-native-google-mobile-ads',
        {
          androidAppId: admob.android,
          iosAppId: admob.ios,
          // No measurement before consent; SDK init and ad loading off the main thread, which is
          // what keeps low-end phones from janking at startup and while a banner loads.
          delayAppMeasurementInit: true,
          optimizeInitialization: true,
          optimizeAdLoading: true,
        },
      ],
    ],
    extra: {
      appVariant: variant,
    },
  };
}

export default function appConfig(): ExpoConfig {
  // Not in git: CI writes it from the GOOGLE_SERVICES_JSON secret (android-dev-build.yml). One file
  // holds both packages once both are added to the Firebase project.
  const googleServices = path.join(__dirname, 'google-services.json');
  const variant = resolveVariant(process.env.APP_VARIANT);
  return buildConfig(variant, {
    googleServicesFile: existsSync(googleServices) ? './google-services.json' : undefined,
    admob: resolveAdMobAppIds(variant, {
      android: process.env.ADMOB_ANDROID_APP_ID,
      ios: process.env.ADMOB_IOS_APP_ID,
    }),
    version: resolveAppVersion({
      name: process.env.APP_VERSION_NAME,
      code: process.env.APP_VERSION_CODE,
    }),
  });
}
