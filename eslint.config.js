const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier');

module.exports = defineConfig([
  expoConfig,
  prettierConfig,
  {
    // supabase/ holds Deno code (npm: specifiers, .ts imports) and SQL: not part of the app build.
    ignores: ['dist/*', '.expo/*', 'supabase/**', 'src/db/migrations/*'],
  },
]);