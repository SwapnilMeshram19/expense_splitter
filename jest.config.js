/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  collectCoverageFrom: ['src/domain/**/*.ts'],
  coverageThreshold: {
    './src/domain/': { branches: 90, functions: 95, lines: 95 },
  },
};