/**
 * Exploratory control-walk over the Instances + Open-Apps panel.
 *
 * This is the NEW-bug finder (vs. instances-panel.spec's targeted regressions):
 * it opens every render-prone UI surface — dialogs, modals, menus, expanders —
 * on a fully-populated panel (a BUILT instance with a dev-linked app) and fails
 * on ANY captured renderer console.error / pageerror via withForge(failOnError).
 * That's exactly the class of silent mount/effect bug (e.g. the NG0600 the
 * keystone caught) that manual QA kept surfacing.
 *
 * Scope note: this is Docker/DB-free. Controls that fire an engine/DB round-trip
 * (setup steps, build, migrate, app-access load, start-process) would fail for
 * ENVIRONMENTAL reasons here, not real bugs — so the walk deliberately drives
 * only client-side surfaces, and dismisses the native confirm() dialogs behind
 * the destructive actions so none of them actually execute. Engine-bound
 * behavior is asserted elsewhere (live-instance e2e / IPC-boundary specs).
 */

import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withForge } from '../helpers/electron-app';
import { seedInstance, seedOpenApps } from '../helpers/mjdev-seed';

const IGNORE = ['favicon', 'ResizeObserver', 'Autofill.enable', 'devtools'];

// PARKED (2026-06-23): deferred until after the planned GUI refactor. The walk is
// tightly coupled to the current panel DOM; rather than write it twice, it will be
// completed once against the refactored structure with stable `data-testid` hooks.
// The console/pageerror capture keystone (in withForge) stays active meanwhile.
// Skipped so it never trips the suite; kept as the working scaffold (steps 1–2 verified).
test.skip('exploratory: every panel surface opens error-free on a built, dev-linked instance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mjdev-explore-'));
  seedInstance(dir, { slug: 'walk', name: 'Walk', built: true, status: 'stopped' });
  seedOpenApps(dir, 'walk', { app: 'bizapps-accounting', mode: 'dev' });

  try {
    await withForge(
      { envOverrides: { MJDEV_CONFIG_DIR: dir }, failOnError: true, ignoreErrors: IGNORE },
      async ({ window }) => {
        // Destructive actions are gated behind native confirm() — auto-dismiss them
        // so clicking the control exercises the UI path without running the op.
        window.on('dialog', d => void d.dismiss().catch(() => {}));

        // ── Open the feature + select the seeded instance ──────────────────
        // The whole feature is a modal dialog; scope every locator to it so we
        // never match the host app's chrome (e.g. the global "+") behind the
        // dialog's CDK backdrop.
        await window.getByText('MJ Dev Manager', { exact: true }).click();
        const panel = window.getByRole('dialog');
        await expect(panel.getByRole('heading', { name: /Instances/ })).toBeVisible();
        await panel.locator('.list li', { hasText: 'Walk' }).click();
        await expect(panel.getByRole('button', { name: /VS Code/ })).toBeVisible();

        // ── 1. Create dialog (toggle open → assert → cancel) ───────────────
        await panel.locator('button:has(mat-icon:text-is("add"))').first().click();
        await expect(panel.getByRole('button', { name: 'Provision' })).toBeVisible();
        await panel.getByRole('button', { name: 'Cancel' }).click();
        await expect(panel.getByRole('button', { name: 'Provision' })).toHaveCount(0);

        // ── 2. Manage personas panel + email-override modal ────────────────
        const personaToggle = panel.locator('button:has(mat-icon:text-is("manage_accounts"))');
        await personaToggle.click();
        await expect(panel.locator('.persona-manage')).toBeVisible();
        await expect(panel.getByRole('heading', { name: 'Add persona' })).toBeVisible();
        // email-override modal (advanced "use a different domain")
        await panel.locator('button.domain-edit').click();
        await expect(panel.locator('.modal-backdrop')).toBeVisible();
        await panel.getByRole('button', { name: 'Cancel' }).click();
        await personaToggle.click(); // toggle the manage panel closed

        // ── 3. Open Apps "Advanced" → mode override → mixed-mode warning ───
        // Instance is dev-mode; selecting "installed" must surface the ⚠ warning.
        await panel.locator('details.advanced summary').click();
        await panel.locator('select[name="addMode"]').selectOption('installed');
        await expect(panel.locator('.dep-warn')).toBeVisible();
        await panel.locator('select[name="addMode"]').selectOption('dev'); // back to matching

        // ── 4. Run… menu (open → assert the panel → close) ─────────────────
        await panel.getByRole('button', { name: /Run…/ }).click();
        await expect(window.locator('.mat-mdc-menu-panel')).toBeVisible();
        await window.keyboard.press('Escape');

        // ── 5. Unlink custom modal (open → assert → cancel) ────────────────
        await panel.getByRole('button', { name: 'Unlink' }).click();
        await expect(window.locator('.modal', { hasText: /Unlink/ })).toBeVisible();
        await window.getByRole('button', { name: 'Cancel' }).click();

        // ── 6. Native-confirm-gated actions: clicking must not error (the
        //      dialog handler dismisses each, so no engine op runs) ─────────
        for (const name of [/Reset schema/, /Repair schema/, /Delete/]) {
          await panel.getByRole('button', { name }).first().click();
        }

        // Settle so any async render error surfaces before teardown asserts.
        await window.waitForTimeout(250);
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
