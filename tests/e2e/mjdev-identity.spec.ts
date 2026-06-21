/**
 * GUI smoke test for MJ Dev Manager Phase 2 (developer identity / personas).
 *
 * Launches the real Electron app, opens the Instances panel, and drives the
 * persona roster UI end-to-end through real IPC → the shared orchestrator
 * engine. Persona CRUD writes to `~/.mjdev/personas.json`, so we point
 * MJDEV_CONFIG_DIR at an isolated temp dir to avoid touching the dev's roster
 * (no Docker required for this slice).
 */

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withForge } from '../helpers/electron-app';

/** A minimal instances.json so the detail panel renders without Docker. */
function seedInstance(dir: string): void {
  const record = {
    id: 'smoke1',
    slug: 'smoke',
    name: 'Smoke',
    branch: 'mjdev/smoke',
    worktreePath: '/tmp/wt/smoke',
    container: { name: 'mjdev-smoke', volume: 'mjdev-smoke-data' },
    ports: { sql: 1443, api: 4010, explorer: 4210 },
    dbName: 'MJ_smoke',
    secretsRef: 'smoke',
    status: 'stopped',
    setup: {
      configWritten: true,
      depsInstalled: false,
      migrated: false,
      codegen: false,
      built: false,
    },
    createdAt: '2026-06-20T00:00:00.000Z',
  };
  writeFileSync(join(dir, 'instances.json'), JSON.stringify({ version: 1, instances: [record] }));
}

test('persona roster UI: add, list, activate', async () => {
  const mjdevDir = mkdtempSync(join(tmpdir(), 'mjdev-gui-'));
  try {
    await withForge({ envOverrides: { MJDEV_CONFIG_DIR: mjdevDir } }, async ({ window }) => {
      // Open the Instances feature from its Welcome quick-action card (dialog).
      await expect(window.getByText('MJ Dev Manager', { exact: true })).toBeVisible();
      await window.getByText('MJ Dev Manager', { exact: true }).click();

      // Panel + identity bar render.
      await expect(window.getByRole('heading', { name: /Instances/ })).toBeVisible();
      const activeSelect = window.locator('select[name="activePersona"]');
      await expect(activeSelect).toBeVisible();

      // Open the inline persona manager and add a persona.
      await window.locator('button:has(mat-icon:text-is("manage_accounts"))').click();
      await window.locator('input[name="pname"]').fill('Admin');
      await window.locator('input[name="pemaillocal"]').fill('admin');
      await window.locator('input[name="proles"]').fill('Owner');
      await window.getByRole('button', { name: 'Add persona' }).click();

      // It appears in the roster list and the active picker, and becomes active.
      await expect(
        window.locator('.persona-list li', { hasText: 'admin@mjdev.local' })
      ).toBeVisible();
      await expect(
        activeSelect.locator('option', { hasText: 'Admin (admin@mjdev.local)' })
      ).toHaveCount(1);

      // Add a second persona and switch the active identity to it.
      await window.locator('input[name="pname"]').fill('Viewer');
      await window.locator('input[name="pemaillocal"]').fill('viewer');
      await window.locator('input[name="proles"]').fill('UI,Developer');
      await window.getByRole('button', { name: 'Add persona' }).click();
      await expect(
        activeSelect.locator('option', { hasText: 'Viewer (viewer@mjdev.local)' })
      ).toHaveCount(1);
      await activeSelect.selectOption({ label: 'Viewer (viewer@mjdev.local)' });

      await window.screenshot({ path: join(mjdevDir, 'persona-ui.png') });

      // The engine persisted the roster + active pointer.
      const roster = JSON.parse(readFileSync(join(mjdevDir, 'personas.json'), 'utf8'));
      expect(roster.personas.map((p: { email: string }) => p.email)).toEqual([
        'admin@mjdev.local',
        'viewer@mjdev.local',
      ]);
      const active = roster.personas.find((p: { id: string }) => p.id === roster.activePersonaId);
      expect(active.email).toBe('viewer@mjdev.local');
    });
  } finally {
    rmSync(mjdevDir, { recursive: true, force: true });
  }
});

test('per-instance Identity card: override selector + actions render', async () => {
  const mjdevDir = mkdtempSync(join(tmpdir(), 'mjdev-gui-'));
  seedInstance(mjdevDir);
  try {
    await withForge({ envOverrides: { MJDEV_CONFIG_DIR: mjdevDir } }, async ({ window }) => {
      await window.getByText('MJ Dev Manager', { exact: true }).click();
      await expect(window.getByRole('heading', { name: /Instances/ })).toBeVisible();

      // Seed a persona so the override list has something to pick.
      await window.locator('button:has(mat-icon:text-is("manage_accounts"))').click();
      await window.locator('input[name="pname"]').fill('Admin');
      await window.locator('input[name="pemaillocal"]').fill('admin');
      await window.getByRole('button', { name: 'Add persona' }).click();

      // Select the seeded instance → detail panel renders.
      await window.locator('.list li', { hasText: 'Smoke' }).click();
      await expect(window.getByRole('heading', { name: 'Identity' })).toBeVisible();

      // The per-instance "Acts as" override defaults to "Use active".
      const override = window.locator('select[name="instPersona"]');
      await expect(override).toBeVisible();
      await expect(override.locator('option', { hasText: /Use active/ })).toHaveCount(1);
      await expect(
        override.locator('option', { hasText: 'Admin (admin@mjdev.local)' })
      ).toHaveCount(1);

      // The two identity actions are wired and present.
      await expect(window.getByRole('button', { name: /Open Explorer as/ })).toBeVisible();
      await expect(window.getByRole('button', { name: /Copy API key/ })).toBeVisible();
      await window.screenshot({ path: join(mjdevDir, 'identity-card.png') });

      // Setting the override persists to the instance record.
      await override.selectOption({ label: 'Admin (admin@mjdev.local)' });
      await expect
        .poll(() => {
          const f = JSON.parse(readFileSync(join(mjdevDir, 'instances.json'), 'utf8'));
          return f.instances[0].personaId;
        })
        .toBeTruthy();
    });
  } finally {
    rmSync(mjdevDir, { recursive: true, force: true });
  }
});
