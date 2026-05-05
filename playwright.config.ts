import { defineConfig } from '@playwright/test';

// Playwright + Electron config for the Forge regression harness.
// Specs live under tests/e2e/. Each test launches its own Electron instance
// via tests/helpers/electron-app.ts.
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/reports/.cache/playwright-results',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: './tests/reports/.cache/e2e.json' }],
    // Custom reporter posts per-test events to the live dashboard when
    // FORGE_LIVE_REPORTER_URL is set. No-op otherwise — safe in CI.
    ['./tests/reporter/playwright-live-reporter.mjs'],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
