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
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright's TS loader emits CJS, so `__dirname` is available natively.
// Avoiding `import.meta.url` keeps this helper loadable from playwright specs.
const REPO_ROOT = join(__dirname, '..', '..');
const MAIN_ENTRY = join(REPO_ROOT, 'packages', 'main', 'dist', 'index.js');
const RENDERER_INDEX = join(REPO_ROOT, 'packages', 'renderer', 'dist', 'browser', 'index.html');

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  /** Per-launch userData dir (isolated tmp). Cleaned up by withForge. */
  userDataDir: string;
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

  // Isolated user-data dir per launch so any profiles / settings created
  // during a test never leak into the next launch (which would shift the
  // welcome screen baseline once a saved profile starts showing up there).
  // The --user-data-dir flag is honored by Electron and routes both
  // electron-store and the keychain credential namespace into the temp dir.
  const userDataDir = mkdtempSync(join(tmpdir(), 'forge-test-userdata-'));

  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      // FORGE_TEST signals the main process to skip non-essential startup
      // (currently: keep the window hidden so it doesn't flash during tests).
      FORGE_TEST: '1',
      // Force production mode so the main process loads the built renderer
      // from disk instead of trying to connect to localhost:4200.
      NODE_ENV: 'production',
      // Surface main-process console output so test failures around IPC /
      // connection / keytar are diagnosable.
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window, userDataDir };
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
    try {
      rmSync(launched.userDataDir, { recursive: true, force: true });
    } catch (err) {
      console.error('[electron-app] failed to clean userData dir:', err);
    }
  }
}
