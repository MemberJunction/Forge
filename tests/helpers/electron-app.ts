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
  /**
   * Renderer `console.error` lines + uncaught `pageerror`s captured for the
   * lifetime of the window. Specs can assert on this directly; `withForge`'s
   * `failOnError` turns a non-empty list into a teardown failure. This is the
   * mechanism that makes otherwise-silent UI errors visible to the test suite.
   */
  consoleErrors: string[];
}

export interface LaunchOptions {
  /**
   * Extra env vars to merge over the default Forge launch env. Useful
   * for tests that need to perturb the host (e.g. restricting PATH so
   * the CLI dep probe fails and the missing-tools view renders).
   */
  envOverrides?: Record<string, string>;
  /**
   * When true, `withForge` throws on teardown if any renderer `console.error`
   * or uncaught `pageerror` was captured during the test. Off by default so
   * existing specs are unaffected; exploratory specs opt in to catch new bugs.
   */
  failOnError?: boolean;
  /**
   * Substrings of console errors to ignore when `failOnError` is set (known,
   * out-of-scope noise — e.g. a dev-only favicon 404).
   */
  ignoreErrors?: string[];
}

export async function launchForge(options: LaunchOptions = {}): Promise<LaunchedApp> {
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
      // Per-test overrides land last so they win over the defaults.
      ...(options.envOverrides ?? {}),
    },
  });

  const window = await app.firstWindow();

  // Capture renderer errors as early as possible (before load settles) so
  // load-time failures aren't missed. Silent console errors / uncaught
  // exceptions are exactly the class of UI bug manual QA kept finding.
  const consoleErrors: string[] = [];
  window.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
  });
  window.on('pageerror', err => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  await window.waitForLoadState('domcontentloaded');
  return { app, window, userDataDir, consoleErrors };
}

/**
 * Convenience wrapper that guarantees teardown even if the test body throws.
 *
 * `optionsOrFn` keeps the original 1-arg form (`withForge(fn)`) working
 * while letting newer tests pass launch options too: `withForge({
 * envOverrides }, fn)`.
 */
export async function withForge<T>(fn: (launched: LaunchedApp) => Promise<T>): Promise<T>;
export async function withForge<T>(
  options: LaunchOptions,
  fn: (launched: LaunchedApp) => Promise<T>
): Promise<T>;
export async function withForge<T>(
  optionsOrFn: LaunchOptions | ((launched: LaunchedApp) => Promise<T>),
  maybeFn?: (launched: LaunchedApp) => Promise<T>
): Promise<T> {
  const [options, fn]: [LaunchOptions, (launched: LaunchedApp) => Promise<T>] =
    typeof optionsOrFn === 'function' ? [{}, optionsOrFn] : [optionsOrFn, maybeFn!];
  const launched = await launchForge(options);
  let result: T;
  try {
    result = await fn(launched);
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
  // After a clean run, optionally fail on captured renderer errors. Done after
  // teardown so the app is always closed first; only triggers when the body
  // itself succeeded (a thrown body error already propagated above).
  if (options.failOnError) {
    const ignore = options.ignoreErrors ?? [];
    const offending = launched.consoleErrors.filter(e => !ignore.some(s => e.includes(s)));
    if (offending.length) {
      throw new Error(
        `[electron-app] ${offending.length} renderer error(s) captured:\n` + offending.join('\n')
      );
    }
  }
  return result;
}
