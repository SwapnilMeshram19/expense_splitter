/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  // The web app (web/) has its own dependencies and build; its package.json would clash in the haste map.
  modulePathIgnorePatterns: ['<rootDir>/web/'],
  collectCoverageFrom: ['src/domain/**/*.ts'],
  coverageThreshold: {
    './src/domain/': { branches: 90, functions: 95, lines: 95 },
  },
};
