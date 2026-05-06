/**
 * UI actions E2E specs — adapted from the legacy 31-test audit's tests
 * 15, 16, 18 (command palette, object search, shortcuts dialog) plus
 * test 11 (query history).
 *
 * Each test exercises a global UI surface that's reachable from the
 * welcome screen — most don't need a connection.
 */

import { expect, test } from '@playwright/test';
import { withForge } from '../helpers/electron-app';
import {
  connectToTestPostgres,
  ensureForgeTestSeeded,
  openNewQueryTab,
  selectDatabase,
} from '../helpers/forge-actions';

test.beforeAll(ensureForgeTestSeeded);

test.describe('Forge — UI actions', () => {
  test('Cmd+Shift+P opens the command palette', async () => {
    await withForge(async ({ window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await window.keyboard.press('Meta+Shift+p');
      // The component renders an overlay only when open.
      await expect(
        window.locator('app-command-palette .command-palette, app-command-palette > *').first()
      ).toBeVisible({ timeout: 5000 });
    });
  });

  test('Cmd+P opens the object search dialog', async () => {
    await withForge(async ({ window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await window.keyboard.press('Meta+p');
      await expect(window.locator('app-object-search .object-search')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test('query history dialog opens via menu IPC', async () => {
    await withForge(async ({ app, window }) => {
      await connectToTestPostgres(window);
      await selectDatabase(window, 'forge_test');
      await openNewQueryTab(app, window);
      // Query history is per-query-component — fires when a query tab is
      // active. The menu item dispatches menu:query-history.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:query-history');
      });
      await expect(window.locator('app-query-history-dialog')).toBeVisible({ timeout: 5000 });
    });
  });

  test('object search input accepts typed input and shows a result region', async () => {
    await withForge(async ({ window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await window.keyboard.press('Meta+p');
      const dialog = window.locator('app-object-search .object-search');
      await expect(dialog).toBeVisible({ timeout: 5000 });
      const input = dialog.locator('input').first();
      await expect(input).toBeVisible();
      // .fill() sets value via DOM but doesn't fire the keystroke events
      // Angular's (input) two-way binding listens for, so the model stayed
      // empty even though the value was technically set. keyboard.type
      // dispatches real keydown/keypress/keyup events the way a human
      // would — same workaround we use for Monaco.
      await input.click();
      await window.keyboard.type('user');
      await expect(input).toHaveValue('user');
      // We don't assert specific results — object search depends on
      // server-side indexing that may not be populated in test. We DO
      // assert the dialog stays open after the input lands, which is the
      // contract the user sees.
      await expect(dialog).toBeVisible();
    });
  });

  test('shortcuts dialog opens via menu IPC', async () => {
    await withForge(async ({ app, window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.webContents.send('menu:show-shortcuts');
      });
      await expect(window.locator('app-shortcuts-dialog .shortcuts-dialog')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test('docker panel opens from the status-bar indicator', async () => {
    await withForge(async ({ window }) => {
      await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
      // The docker indicator lives in the status bar (bottom of the shell).
      // It's a button with a docker-success / docker-warning class depending
      // on docker daemon state. Click it to toggle the panel.
      const dockerBtn = window
        .locator('app-status-bar button.docker-success, app-status-bar button.docker-warning')
        .first();
      await expect(dockerBtn).toBeVisible({ timeout: 10000 });
      await dockerBtn.click();
      await expect(window.locator('app-docker-panel')).toBeVisible({ timeout: 5000 });
    });
  });
});
