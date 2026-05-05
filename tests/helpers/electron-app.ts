/**
 * Electron launch helper for E2E tests.
 *
 * Spins up the built Forge app via Playwright's Electron driver, waits for
 * the renderer to load, and returns the app + first window. Each test should
 * call `launchForge()` and `await app.close()` (or use the helper's
 * `withForge` form for guaranteed teardown).
 *
 * Requires `npm run build` to have produced packages/main/dist/index.js and
 * packages/renderer/dist/browser/index.html.
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Playwright's TS loader emits CJS, so `__dirname` is available natively.
// Avoiding `import.meta.url` keeps this helper loadable from playwright specs.
const REPO_ROOT = join(__dirname, '..', '..');
const MAIN_ENTRY = join(REPO_ROOT, 'packages', 'main', 'dist', 'index.js');
const RENDERER_INDEX = join(REPO_ROOT, 'packages', 'renderer', 'dist', 'browser', 'index.html');

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
}

export async function launchForge(): Promise<LaunchedApp> {
  if (!existsSync(MAIN_ENTRY)) {
    throw new Error(
      `[electron-app] expected built main process at ${MAIN_ENTRY}. ` +
        `Run \`npm run build\` first.`
    );
  }
  if (!existsSync(RENDERER_INDEX)) {
    throw new Error(
      `[electron-app] expected renderer build at ${RENDERER_INDEX}. ` +
        `Run \`npm run build\` first.`
    );
  }

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // FORGE_TEST signals the main process to skip non-essential startup
      // (analytics, auto-update checks) if it ever needs to. Currently a hint
      // for future use — no consumer yet.
      FORGE_TEST: '1',
      // Force production mode so the main process loads the built renderer
      // from disk instead of trying to connect to localhost:4200.
      NODE_ENV: 'production',
    },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

/**
 * Convenience wrapper that guarantees teardown even if the test body throws.
 */
export async function withForge<T>(fn: (launched: LaunchedApp) => Promise<T>): Promise<T> {
  const launched = await launchForge();
  try {
    return await fn(launched);
  } finally {
    try {
      await launched.app.close();
    } catch (err) {
      console.error('[electron-app] failed to close Forge cleanly:', err);
    }
  }
}
