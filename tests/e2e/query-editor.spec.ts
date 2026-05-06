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
});
