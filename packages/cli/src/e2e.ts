import { chromium, type Browser, type Page } from 'playwright';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { InstanceOrchestrator, EventSink } from '@mj-forge/orchestrator';

/**
 * Headless GUI test harness for a local instance's Explorer, driven through
 * Playwright. It exists so an agent can verify the *rendered* app — most
 * importantly that a persona sees the FULL app switcher (the single-app
 * magic-link lock we fixed), not just that the DB has grants.
 *
 * Security scoping (least privilege — the whole reason this is a vetted command
 * instead of ad-hoc curl/browser steps):
 *   - It never accepts a URL or host. The only page it visits is the one
 *     {@link InstanceOrchestrator.openExplorerAs} returns, which is hardcoded to
 *     `http://localhost:<instance explorer port>`. A belt-and-suspenders check
 *     refuses any non-localhost target.
 *   - The instance is resolved ONLY by slug through the orchestrator's registry
 *     (`~/.mjdev/instances.json`); there is no code path to point it at an
 *     arbitrary port/host.
 *   - Identity is the instance's roster persona (the same resolution the GUI and
 *     `mjdev explorer-url` use); no persona/email/role can be injected here.
 *   - It is read-only: it calls ONLY `info`/`whoami`/`openExplorerAs`, drives the
 *     browser (which runs the Explorer SPA's own normal read traffic), and never
 *     pulls the JWT out to call the API directly. The token is redacted in output.
 */
export type E2ECheck = 'apps' | 'login';

export interface E2EOptions {
  check: E2ECheck;
  /** Minimum apps the switcher must show for `--check apps` to pass. */
  minApps: number;
  headed: boolean;
  /** Per-step wait budget (ms). */
  timeoutMs: number;
  screenshotDir: string;
  sink: EventSink;
}

export interface E2EResult {
  success: boolean;
  /** Distinguishes a failed assertion from an operational error for agents. */
  failureKind?: 'assertion' | 'operational';
  slug: string;
  check: E2ECheck;
  /** Explorer URL with the `#token=` redacted. */
  url: string;
  persona?: { email: string };
  appCount: number;
  apps: string[];
  durationMs: number;
  details: string;
  screenshotPath?: string;
}

/** Replace everything after `#token=` so the JWT never lands in logs/output. */
function redactToken(url: string): string {
  return url.replace(/#token=.*/, '#token=<redacted>');
}

function emit(
  sink: EventSink,
  slug: string,
  level: 'progress' | 'success' | 'warn' | 'error',
  message: string
): void {
  try {
    sink({ slug, op: 'e2e', level, message, at: new Date().toISOString() });
  } catch {
    /* never let a sink break the harness */
  }
}

/** True when chromium.launch failed because the browser binary isn't installed. */
function isBrowserMissing(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /Executable doesn't exist|playwright install|npx playwright install/i.test(m);
}

/**
 * Run a GUI check against an instance's Explorer. Never throws for assertion
 * failures — returns an {@link E2EResult} with `success:false`. Throws only for
 * truly unexpected internal errors (the caller maps everything to a clean exit).
 */
export async function runE2E(
  orchestrator: InstanceOrchestrator,
  slug: string,
  opts: E2EOptions
): Promise<E2EResult> {
  const startedAt = Date.now();
  const base: E2EResult = {
    success: false,
    slug,
    check: opts.check,
    url: '',
    appCount: 0,
    apps: [],
    durationMs: 0,
    details: '',
  };
  const done = (r: Partial<E2EResult>): E2EResult => ({
    ...base,
    ...r,
    durationMs: Date.now() - startedAt,
  });

  // Registry-only resolution + roster persona (read-only orchestrator calls).
  let persona: { email: string } | undefined;
  try {
    const who = await orchestrator.whoami(slug);
    persona = { email: who.email };
  } catch (err) {
    return done({
      failureKind: 'operational',
      details: `Could not resolve instance/persona: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Mint the session via the SAME path the GUI uses; returns a localhost URL.
  let url: string;
  try {
    url = await orchestrator.openExplorerAs(slug, opts.sink);
  } catch (err) {
    return done({
      persona,
      failureKind: 'operational',
      details: `openExplorerAs failed (is MJAPI running on the instance?): ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  base.url = redactToken(url);

  // Guard: only ever drive a localhost target.
  const target = new URL(url);
  if (target.hostname !== 'localhost' && target.hostname !== '127.0.0.1') {
    return done({
      persona,
      failureKind: 'operational',
      details: `refusing non-localhost target: ${target.hostname}`,
    });
  }

  let browser: Browser | undefined;
  try {
    try {
      // Drive the system-installed Google Chrome (channel:'chrome') so no
      // Playwright browser binary needs downloading — Chrome's built-in headless
      // mode is used directly. (To instead use Playwright's pinned chromium build,
      // run `npx playwright install --no-shell chromium` and switch to
      // channel:'chromium'; we prefer system Chrome here to avoid a ~150MB fetch.)
      browser = await chromium.launch({ headless: !opts.headed, channel: 'chrome' });
    } catch (err) {
      if (isBrowserMissing(err)) {
        return done({
          persona,
          failureKind: 'operational',
          details:
            'No usable Chrome found. Install Google Chrome, or run `npx playwright install --no-shell chromium` and switch the harness to channel:"chromium".',
        });
      }
      throw err;
    }

    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(opts.timeoutMs);

    // Watch for the exact auth-failure symptom: a 401 on the metadata bootstrap.
    let sawAuthError = false;
    page.on('response', r => {
      if (r.status() === 401) sawAuthError = true;
    });

    emit(opts.sink, slug, 'progress', `Loading Explorer for ${persona?.email}…`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      // The Explorer dev server isn't up (or still compiling) — a clean
      // operational failure, not an assertion about the app.
      if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|net::ERR/i.test(m)) {
        return done({
          persona,
          failureKind: 'operational',
          details: `Explorer dev server not reachable on ${target.origin} (start it / wait for it to finish compiling).`,
        });
      }
      throw err;
    }

    // The SPA reads the #token hash, stores the session, then strips the hash.
    // String predicate so it runs in the browser (no DOM lib in the CLI's TS).
    await page
      .waitForFunction("!window.location.hash.includes('token')", undefined, {
        timeout: opts.timeoutMs,
      })
      .catch(() => undefined);
    // Soft settle for the initial GraphQL bootstrap; don't hard-fail on it.
    await page.waitForLoadState('networkidle', { timeout: opts.timeoutMs }).catch(() => undefined);

    // Authenticated chrome anchor: the user avatar button in the shell header.
    const avatar = page.locator('.avatar-btn');
    const authed = await avatar
      .first()
      .waitFor({ state: 'visible', timeout: opts.timeoutMs })
      .then(() => true)
      .catch(() => false);

    if (sawAuthError || !authed) {
      const screenshotPath = await capture(page, opts.screenshotDir, slug, opts.check);
      return done({
        persona,
        failureKind: sawAuthError ? 'assertion' : 'operational',
        details: sawAuthError
          ? 'Authentication failed (401) — the session token was rejected (e.g. a stale token or wrong signing key).'
          : 'Explorer did not reach an authenticated state within the timeout.',
        screenshotPath,
      });
    }

    if (opts.check === 'login') {
      emit(opts.sink, slug, 'success', 'Logged in (no 401, authenticated chrome present).');
      return done({ persona, success: true, details: 'Authenticated session loaded.' });
    }

    // --check apps: assert the FULL app switcher renders (the regression).
    const result = await countApps(page, opts.timeoutMs);
    if (!result.switcherPresent) {
      const screenshotPath = await capture(page, opts.screenshotDir, slug, opts.check);
      return done({
        persona,
        failureKind: 'assertion',
        details:
          'App switcher (<mj-app-switcher>) is absent — the session is locked to a single app (the bug we fixed).',
        screenshotPath,
      });
    }
    if (result.count < opts.minApps) {
      const screenshotPath = await capture(page, opts.screenshotDir, slug, opts.check);
      return done({
        persona,
        appCount: result.count,
        apps: result.names,
        failureKind: 'assertion',
        details: `Only ${result.count} app(s) visible; expected at least ${opts.minApps}.`,
        screenshotPath,
      });
    }

    emit(opts.sink, slug, 'success', `App switcher shows ${result.count} apps.`);
    return done({
      persona,
      success: true,
      appCount: result.count,
      apps: result.names,
      details: `App switcher renders ${result.count} apps (>= ${opts.minApps}).`,
    });
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * Open the app switcher dropdown and count the real app entries. The switcher
 * host is absent entirely for an app-locked session (shell `@if (!appSwitchingLocked)`),
 * the dropdown is collapsed by default, and it shows a loading spinner while apps
 * load — so we wait for the host, ensure it's not loading, open it, then count
 * `.app-switcher-item` excluding the pinned `.configure-item`.
 */
async function countApps(
  page: Page,
  timeoutMs: number
): Promise<{ switcherPresent: boolean; count: number; names: string[] }> {
  const host = page.locator('mj-app-switcher');
  const present = await host
    .first()
    .waitFor({ state: 'attached', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  if (!present) return { switcherPresent: false, count: 0, names: [] };

  // Wait out the loading spinner, then open the dropdown.
  await page
    .locator('mj-app-switcher .app-switcher-container:not(.loading)')
    .first()
    .waitFor({ state: 'attached', timeout: timeoutMs })
    .catch(() => undefined);
  await page.locator('mj-app-switcher .app-switcher-button').first().click({ timeout: timeoutMs });

  const items = page.locator('mj-app-switcher .app-switcher-item:not(.configure-item)');
  await items
    .first()
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .catch(() => undefined);
  const count = await items.count();
  const names = (await items.allInnerTexts()).map(t => t.trim()).filter(Boolean);
  return { switcherPresent: true, count, names };
}

/** Write a full-page failure screenshot; returns its path (best-effort). */
async function capture(
  page: Page,
  dir: string,
  slug: string,
  check: string
): Promise<string | undefined> {
  try {
    await fs.mkdir(dir, { recursive: true });
    // Time-free, slug+check-scoped name so reruns overwrite rather than pile up.
    const file = path.join(dir, `${slug}-${check}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return undefined;
  }
}

/** Default screenshot directory under the shared mjdev home. */
export function defaultScreenshotDir(): string {
  return path.join(os.homedir(), '.mjdev', 'e2e-screenshots');
}
