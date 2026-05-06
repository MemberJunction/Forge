/**
 * Visual baselines — post-connection states.
 *
 * Connects to the seeded PostgreSQL test container (forge_test) and
 * captures the UI states that only exist when Forge has an active
 * connection: explorer tree populated, query editor open, results grid
 * after running a query.
 *
 * Each test launches a fresh Electron with an isolated user-data dir
 * (via withForge → launchForge), so the Connect button's "save profile"
 * side-effect doesn't leak between tests or pollute the welcome baseline.
 */

import { expect, test, type Page } from '@playwright/test';
import { Client as PgClient } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withForge } from '../../helpers/electron-app';

/**
 * Seed the default `forge_test` postgres database with the synthetic
 * schema + data once before the visual tests run. The integration tier
 * uses `withFreshDatabase` (per-test isolated DBs) so the default
 * `forge_test` stays empty otherwise — visual specs that connect to it
 * via Forge would see an empty database.
 *
 * Idempotent: skips if the products table already exists. Re-runs after
 * a `Reset harness` (volumes wiped) bring the DB back to empty.
 */
async function ensureForgeTestSeeded() {
  const client = new PgClient({
    host: '127.0.0.1',
    port: 15432,
    user: 'forge',
    password: 'forge',
    database: 'forge_test',
  });
  await client.connect();
  try {
    const r = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products'"
    );
    if (r.rowCount && r.rowCount > 0) return;
    const fixturesRoot = join(__dirname, '..', '..', 'fixtures', 'postgres');
    const schema = readFileSync(join(fixturesRoot, 'schema.sql'), 'utf8');
    const seed = readFileSync(join(fixturesRoot, 'seed.sql'), 'utf8');
    await client.query(schema);
    await client.query(seed);
  } finally {
    await client.end();
  }
}

test.beforeAll(ensureForgeTestSeeded);

async function fillField(dialog: ReturnType<Page['locator']>, label: string, value: string) {
  // Material's outlined form fields don't expose a real <label for=…> that
  // Playwright's getByLabel can match — the mat-label lives inside the
  // notched outline. Match by the form-field's accessible text instead.
  const field = dialog
    .locator('mat-form-field')
    .filter({ has: dialog.page().locator(`mat-label:text-is("${label}")`) })
    .first();
  await field.locator('input, textarea').fill(value);
}

async function connectToTestPostgres(window: Page) {
  await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });

  // Open New Connection dialog from the welcome screen.
  await window.locator('mat-card[aria-label="New Connection"]').click();
  const dialog = window.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10000 });

  // Switch engine to PostgreSQL.
  await dialog.locator('mat-select').first().click();
  await window.locator('mat-option').filter({ hasText: 'PostgreSQL' }).first().click();
  await window.waitForTimeout(300);

  // Fill the form against the seeded test PG container.
  await fillField(dialog, 'Connection Name', 'Test PG');
  await fillField(dialog, 'Server', '127.0.0.1');
  await fillField(dialog, 'Port', '15432');
  await fillField(dialog, 'Username', 'forge');
  await fillField(dialog, 'Password', 'forge');
  await fillField(dialog, 'Default Database', 'forge_test');

  // The test PG container doesn't speak SSL (it's a stock dev image), but
  // Forge defaults to "Encrypt Connection" on for security. Uncheck it.
  await dialog
    .locator('mat-checkbox')
    .filter({ hasText: 'Encrypt Connection' })
    .locator('input[type="checkbox"]')
    .uncheck({ force: true });

  // Click the primary "Connect" button (saves + connects).
  await dialog.getByRole('button', { name: /^Connect$/ }).click();

  // Wait for connected-state indicators in the sidebar.
  await expect(window.locator('app-sidebar .database-selector')).toBeVisible({ timeout: 20000 });
  // Settle: explorer tree fetches schemas/tables.
  await window.waitForTimeout(1500);
  // Dismiss the "Connected to Test PG" snackbar so it doesn't appear in
  // visual baselines (it would fade out on its own and cause flakes).
  await window
    .locator('.mat-mdc-snack-bar-container button')
    .first()
    .click({ timeout: 2000 })
    .catch(() => {
      /* snackbar may have already auto-dismissed */
    });
  await window.waitForTimeout(300);
}

/**
 * Selects the seeded `forge_test` database from the sidebar so menu-driven
 * actions like New Query (which require selectedDatabase()) can fire.
 */
async function selectForgeTestDatabase(window: Page) {
  // Click the database picker in the sidebar — opens a menu with the
  // available DBs.
  await window.locator('app-sidebar .database-selector button').first().click();
  await window
    .locator('.mat-mdc-menu-panel button, .mat-mdc-menu-panel [role="menuitem"]')
    .filter({ hasText: 'forge_test' })
    .first()
    .click();
  // Settle: explorer tree re-renders for the chosen DB.
  await window.waitForTimeout(800);
}

test.describe('Forge — connected visual baselines', () => {
  test('sidebar with populated explorer tree', async () => {
    await withForge(async ({ window }) => {
      await connectToTestPostgres(window);
      // Capture just the sidebar — full-window captures have dynamic content
      // (docker container uptime strings, snackbar fade) that would flake.
      // Sidebar shows the connected state and explorer tree, which is what
      // we actually want to lock down.
      const sidebar = window.locator('app-sidebar');
      await expect(sidebar).toHaveScreenshot('sidebar-connected-pg.png');
    });
  });

  test('query editor — empty new tab', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectForgeTestDatabase(window);
      // Fire the menu:new-query IPC — same channel the macOS menu's
      // "New Query" item uses. Opens a fresh query tab against the
      // active connection's selected database.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:new-query');
      });
      // Monaco editor renders inside the new tab.
      const editor = window.locator('.monaco-editor').first();
      await expect(editor).toBeVisible({ timeout: 10000 });
      // Settle: Monaco's font + layout finish painting.
      await window.waitForTimeout(800);
      // Capture the main area (excluding sidebar) so the editor reads
      // in context with its toolbar and tabs.
      const mainArea = window
        .locator('.main-area, app-shell .main-area, [class*="main-area"]')
        .first();
      await expect(mainArea).toHaveScreenshot('query-editor-empty.png');
    });
  });

  test('result grid — products query', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectForgeTestDatabase(window);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:new-query');
      });
      const editor = window.locator('.monaco-editor').first();
      await expect(editor).toBeVisible({ timeout: 10000 });
      await window.waitForTimeout(500); // let Monaco finish initializing
      // Click into the editor to focus, then type via keyboard. Monaco's
      // .fill() on the hidden textarea silently no-ops; keyboard.type
      // routes through the focused editor's standard input handlers.
      await editor.click();
      await window.keyboard.type(
        'SELECT id, sku, name, price_cents FROM products ORDER BY id LIMIT 10;'
      );
      await window.waitForTimeout(300);
      // Cmd+E executes per Forge's SSMS-style binding.
      await window.keyboard.press('Meta+e');
      // Forge shows a one-time "Execute Query?" confirm on first run with
      // a fresh userData (which we always have — withForge isolates each
      // launch). Dismiss by clicking Execute.
      await window
        .getByRole('button', { name: /^Execute$/ })
        .click({ timeout: 3000 })
        .catch(() => {
          /* dialog may not appear on subsequent runs */
        });
      // Wait for the results grid to render — ag-grid is the result viewer.
      const grid = window.locator('ag-grid-angular, .ag-root-wrapper').first();
      await expect(grid).toBeVisible({ timeout: 15000 });
      await window.waitForTimeout(1500);
      const mainArea = window
        .locator('.main-area, app-shell .main-area, [class*="main-area"]')
        .first();
      await expect(mainArea).toHaveScreenshot('result-grid-products.png');
    });
  });
});
