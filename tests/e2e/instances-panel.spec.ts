/**
 * Seeded GUI regression spec for the Instances panel + proof that the harness's
 * console/pageerror capture (withForge `failOnError`) actually fails on UI errors.
 *
 * Renders deterministically by pointing MJDEV_CONFIG_DIR at an isolated temp dir
 * seeded with a fake instances.json — no Docker, worktree, or DB needed.
 */

import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withForge } from '../helpers/electron-app';
import { seedInstance } from '../helpers/mjdev-seed';

// Benign, out-of-scope console noise that shouldn't fail a spec.
const IGNORE = ['favicon', 'ResizeObserver', 'Autofill.enable', 'devtools'];

test('Instances panel renders a seeded instance — presence + selection behavior, error-free', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mjdev-panel-'));
  seedInstance(dir, { slug: 'smoke', name: 'Smoke', built: true });
  try {
    await withForge(
      { envOverrides: { MJDEV_CONFIG_DIR: dir }, failOnError: true, ignoreErrors: IGNORE },
      async ({ window }) => {
        // Open the feature from the Welcome quick-action card.
        await window.getByText('MJ Dev Manager', { exact: true }).click();
        await expect(window.getByRole('heading', { name: /Instances/ })).toBeVisible();

        // PRESENCE: the seeded instance is listed.
        const row = window.locator('.list li', { hasText: 'Smoke' });
        await expect(row).toBeVisible();

        // BEHAVIOR: selecting it populates the detail panel with this instance's data.
        await row.click();
        await expect(window.getByText('4010', { exact: false }).first()).toBeVisible();
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harness fails the spec on a renderer console.error (capture keystone)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mjdev-panel-err-'));
  seedInstance(dir, { slug: 'smoke', name: 'Smoke' });
  let caught = '';
  try {
    await withForge(
      { envOverrides: { MJDEV_CONFIG_DIR: dir }, failOnError: true, ignoreErrors: IGNORE },
      async ({ window }) => {
        await window.evaluate(() => console.error('INJECTED-TEST-ERROR-XYZ'));
      }
    );
  } catch (err) {
    caught = err instanceof Error ? err.message : String(err);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // The capture must have turned the injected console.error into a thrown failure.
  expect(caught).toContain('INJECTED-TEST-ERROR-XYZ');
});
