/** @type {import('jest').Config} */
module.exports = {
  projects: [
    '<rootDir>/packages/shared',
    '<rootDir>/packages/main',
  ],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
