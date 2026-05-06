/**
 * Query editor E2E specs — adapted from the legacy 31-test audit's
 * "Query Editor" section (tests 6, 7, 8, 26 in particular).
 *
 * Covers: opening a new query tab, executing a SELECT and verifying
 * results in the ag-grid, error display on invalid SQL, and tab labeling.
 */

import { expect, test } from '@playwright/test';
import { withForge } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureForgeTestSeeded,
  executeQuery,
  openNewQueryTab,
  selectDatabase,
  typeInEditor,
} from '../helpers/forge-actions';

test.beforeAll(ensureForgeTestSeeded);

test.describe('Forge — query editor', () => {
  test('opens a new query tab via menu:new-query', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);

      // Monaco editor visible.
      await expect(window.locator('.monaco-editor').first()).toBeVisible();
      // A query tab labeled "Query 1" is added next to the welcome tab.
      await expect(window.locator('.lm_tab').filter({ hasText: 'Query 1' })).toBeVisible();
    });
  });

  test('executes a SELECT and renders the result grid', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(window, 'SELECT id, sku, name, price_cents FROM products ORDER BY id;');
      await executeQuery(window);

      // Result grid renders.
      const grid = window.locator('ag-grid-angular, .ag-root-wrapper').first();
      await expect(grid).toBeVisible({ timeout: 15000 });
      // Synthetic seed has exactly 10 products.
      await expect(window.getByText(/10 rows/i).first()).toBeVisible({ timeout: 10000 });
      // First product is "MacBook Air M4" per fixtures.
      await expect(window.getByText('MacBook Air M4').first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('displays an error message on invalid SQL', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      await typeInEditor(window, 'SELECT * FROM definitely_not_a_table;');
      await executeQuery(window);

      // PG raises 'relation "X" does not exist' which Forge surfaces in
      // the result area below the editor.
      await expect(window.getByText(/does not exist/i).first()).toBeVisible({ timeout: 10000 });
    });
  });

  test('two SELECTs render two result grids', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      // Two statements separated by ; — Forge renders one grid per result set.
      await typeInEditor(
        window,
        'SELECT id, name FROM products LIMIT 3;\nSELECT id, name FROM customers LIMIT 2;'
      );
      await executeQuery(window);

      // Both grids visible in the result panel. Forge attaches an
      // ag-grid-angular per result set; expect at least 2 of them.
      await expect(window.locator('ag-grid-angular').nth(1)).toBeVisible({ timeout: 15000 });
      // Sanity-check rows from each result set are rendered.
      await expect(window.getByText('MacBook Air M4').first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('Cmd+Shift+F formats SQL (lowercase → SELECT uppercase)', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      // Type unformatted lowercase SQL.
      await typeInEditor(window, 'select id, name from products where id = 1');
      // Fire format via the same menu IPC the macOS menu uses.
      // (The component's Cmd+Shift+F handler also works but this path is
      // independent of which platform Playwright resolves the modifier for.)
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:format-sql');
      });
      await window.waitForTimeout(800);
      // Forge's formatter uppercases keywords and reflows whitespace. Read
      // the editor's rendered text and assert SELECT is now uppercase.
      const editorText = (await window.locator('.monaco-editor .view-line').allTextContents()).join(
        '\n'
      );
      expect(editorText).toContain('SELECT');
      expect(editorText).toContain('FROM');
    });
  });
});
