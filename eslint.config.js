const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // Screens and features read and write through the data store (src/data), never the old
    // local-first tables. Only device settings, receipt bookkeeping and the one-time hand-over
    // (src/legacy, via auth and the root layout) may touch them.
    files: ['src/app/**', 'src/features/**', 'src/data/**', 'src/ui/**', 'src/api/**'],
    ignores: ['**/__tests__/**', 'src/features/auth/authStore.ts', 'src/app/_layout.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/repositories/*', '!@/db/repositories/profile', '!@/db/repositories/receipts'],
              message: 'Use the data store (@/data) instead of the legacy local tables.',
            },
            { group: ['@/legacy', '@/legacy/*'], message: 'Legacy code runs only from the hand-over.' },
          ],
        },
      ],
    },
  },
  {
    // supabase/ holds Deno code (npm: specifiers, .ts imports) and SQL: not part of the app build.
    // web/ is the browser app: typechecked and built by its own config (npm run web:check).
    ignores: ['dist/*', '.expo/*', 'supabase/**', 'src/db/migrations/*', 'web/**'],
  },
]);