/**
 * Visual baselines — connection dialog variants.
 *
 * Forge's connection dialog renders engine-specific form fields
 * (auth options, ports, defaults) and exposes an optional SSH-tunnel
 * section. These baselines lock down the layout for each meaningful
 * variant so a refactor that breaks one engine's form is caught.
 */

import { expect, test, type Page } from '@playwright/test';
import { withForge } from '../../helpers/electron-app';

async function openConnectionDialog(window: Page) {
  await expect(window.locator('app-root')).toBeVisible({ timeout: 15000 });
  await window.locator('mat-card[aria-label="New Connection"]').click();
  const dialog = window.locator('mat-dialog-container');
  await expect(dialog).toBeVisible({ timeout: 10000 });
  return dialog;
}

async function selectEngine(window: Page, label: string) {
  // The engine dropdown is the first mat-select in the dialog.
  await window.locator('mat-dialog-container mat-select').first().click();
  // mat-option lives in a CDK overlay panel outside the dialog DOM.
  await window.locator('mat-option').filter({ hasText: label }).first().click();
  // Settle: Angular runs onEngineChange (updates port, defaults, fields).
  await window.waitForTimeout(400);
}

test.describe('Forge — connection dialog variants', () => {
  test('postgresql engine selected', async () => {
    await withForge(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      await selectEngine(window, 'PostgreSQL');
      await expect(dialog).toHaveScreenshot('postgresql-engine-selected.png');
    });
  });

  test('mysql engine selected', async () => {
    await withForge(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      await selectEngine(window, 'MySQL');
      await expect(dialog).toHaveScreenshot('mysql-engine-selected.png');
    });
  });

  test('ssh tunnel section expanded', async () => {
    await withForge(async ({ window }) => {
      const dialog = await openConnectionDialog(window);
      // The SSH checkbox is a single mat-checkbox labeled "Connect via SSH tunnel".
      await dialog.locator('mat-checkbox').filter({ hasText: 'Connect via SSH tunnel' }).click();
      // Settle: Angular reveals the SSH form fields below the checkbox.
      await window.waitForTimeout(400);
      await expect(dialog).toHaveScreenshot('ssh-tunnel-section-expanded.png');
    });
  });
});
