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
import { withForge } from '../../helpers/electron-app';

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
});
