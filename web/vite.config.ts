/**
 * Web app build. The shared layer (../src/domain, ../src/api, ../src/data and a few pure feature
 * helpers) is imported through the same `@/` alias the app uses, so one change shows up in both.
 *
 * Two platform modules are swapped for browser versions (exact-match aliases win over `@/`):
 *   @/lib/supabase -> src/platform/supabase.ts   (localStorage session instead of SecureStore)
 *   @/lib/newId    -> src/platform/newId.ts      (Web Crypto instead of expo-crypto)
 *
 * Anything React Native / Expo that sneaks into the import graph fails the build with the
 * importer's name, instead of bundling megabytes of react-native-web by accident.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.resolve(here, '../src');

const NATIVE_ONLY =
  /^(react-native|react-native-.+|@react-native(-community)?\/.+|expo|expo-.+|@expo\/.+|drizzle-orm)(\/.*)?$/;

function forbidNativeImports(): Plugin {
  return {
    name: 'forbid-native-imports',
    enforce: 'pre',
    resolveId(source, importer) {
      if (NATIVE_ONLY.test(source)) {
        const from = importer ? path.relative(here, importer) : 'unknown';
        this.error(
          `"${source}" is native-only but is imported by ${from}. ` +
            'Keep shared code free of React Native/Expo, or add a browser version under web/src/platform.',
        );
      }
      return null;
    },
  };
}

export default defineConfig({
  // One tsconfig for every file, shared ones included. Without it, files in ../src pick up the
  // app's tsconfig, which extends expo/tsconfig.base: not installed in the web-only build.
  tsconfig: 'tsconfig.json',
  plugins: [forbidNativeImports(), react()],
  resolve: {
    alias: [
      { find: /^@\/lib\/supabase$/, replacement: path.resolve(here, 'src/platform/supabase.ts') },
      { find: /^@\/lib\/newId$/, replacement: path.resolve(here, 'src/platform/newId.ts') },
      { find: /^@\/(.*)$/, replacement: `${shared}/$1` },
    ],
    // Shared files live outside web/, so Node resolution from them would find the app's copies in
    // ../node_modules. One copy each (React especially: two copies break hooks).
    dedupe: ['react', 'react-dom', '@supabase/supabase-js', 'qrcode-generator'],
  },
  server: {
    port: 5173,
    strictPort: true, // WEB_ORIGINS and Google's JavaScript origins list this exact port
    fs: { allow: [here, shared] },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    // Low-end phones on mobile data: keep the first load small and warn if it grows.
    chunkSizeWarningLimit: 350,
    rolldownOptions: {
      output: {
        // Libraries change rarely: their own long-cached file survives most deploys.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|wouter)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/](@supabase|tslib|iceberg-js)[\\/]/ },
          ],
        },
      },
    },
  },
});
