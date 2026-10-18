/**
 * Expo app config: the single source of truth (app.json is gone).
 *
 * Two variants, picked by APP_VARIANT at config time (prebuild, `expo start`, CI):
 * - development (default): package in.ssoftapp.split.dev, "Split Dev", orange icon. Installs next to
 *   the Play Store app, has its own local SQLite and talks to the dev Supabase project.
 * - production: package in.ssoftapp.split. Only the release workflow sets APP_VARIANT=production.
 *
 * Supabase URL/key and the Google web client ID are NOT here: they're EXPO_PUBLIC_* values read in
 * src/lib/env.ts, and Expo picks them from .env.development* / .env.production* by build mode.
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

const POPPINS_DIR = './node_modules/@expo-google-fonts/poppins';
const POPPINS_WEIGHTS = [
  { weight: 400, file: '400Regular/Poppins_400Regular.ttf' },
  { weight: 500, file: '500Medium/Poppins_500Medium.ttf' },
  { weight: 600, file: '600SemiBold/Poppins_600SemiBold.ttf' },
  { weight: 700, file: '700Bold/Poppins_700Bold.ttf' },
] as const;

interface BuildOptions {
  /** Firebase config for push. Missing → the app builds and works, just without push. */
  googleServicesFile?: string;
}

export function buildConfig(variant: AppVariant, options: BuildOptions = {}): ExpoConfig {
  const v = VARIANTS[variant];

  return {
    name: v.name,
    slug: 'expense-splitter',
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
                fontFamily: 'Poppins',
                fontDefinitions: POPPINS_WEIGHTS.map(({ weight, file }) => ({
                  path: `${POPPINS_DIR}/${file}`,
                  weight,
                })),
              },
            ],
          },
          ios: {
            fonts: POPPINS_WEIGHTS.map(({ file }) => `${POPPINS_DIR}/${file}`),
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
  return buildConfig(resolveVariant(process.env.APP_VARIANT), {
    googleServicesFile: existsSync(googleServices) ? './google-services.json' : undefined,
  });
}
