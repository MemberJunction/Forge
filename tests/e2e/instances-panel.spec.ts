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

test('Advanced card exposes the AI-enrichment toggle (default off) and the setup card documents the convention loop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mjdev-panel-ai-'));
  seedInstance(dir, { slug: 'smoke', name: 'Smoke', built: true });
  try {
    await withForge(
      { envOverrides: { MJDEV_CONFIG_DIR: dir }, failOnError: true, ignoreErrors: IGNORE },
      async ({ window }) => {
        await window.getByText('MJ Dev Manager', { exact: true }).click();
        const row = window.locator('.list li', { hasText: 'Smoke' });
        await row.click();

        // Setup card documents that "Run full setup" continues into the ADR-009 loop.
        await expect(
          window.getByText(/continues automatically with the convention loop/i)
        ).toBeVisible();

        // AI-enrichment toggle is present and OFF by default.
        const toggle = window.locator('.ai-toggle input[type="checkbox"]');
        await expect(toggle).toBeVisible();
        await expect(toggle).not.toBeChecked();

        // The on-demand CodeGen button reflects the toggle (no tokens unless opted in).
        const codegenBtn = window.locator('button', { hasText: 'Run CodeGen' });
        await expect(codegenBtn).toBeVisible();
        await expect(codegenBtn).not.toContainText('+ AI');
        await toggle.check();
        await expect(codegenBtn).toContainText('+ AI');
      }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup-loop surfacing: a loop warn raises a dismissible notice; an escalation raises a NON-dismissing modal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mjdev-panel-esc-'));
  seedInstance(dir, { slug: 'smoke', name: 'Smoke', built: true });
  try {
    await withForge(
      { envOverrides: { MJDEV_CONFIG_DIR: dir }, failOnError: true, ignoreErrors: IGNORE },
      async ({ window, app }) => {
        await window.getByText('MJ Dev Manager', { exact: true }).click();
        await window.locator('.list li', { hasText: 'Smoke' }).click();

        // (1) Non-blocking loop warning (first-failure / drift tripwire) → notice banner.
        // Broadcast a synthetic InstanceEvent on the real IPC channel from the MAIN
        // process — the same path the orchestrator uses — so the renderer's listener
        // fires exactly as in production (no real failing setup needed).
        await app.evaluate(({ BrowserWindow }) => {
          for (const w of BrowserWindow.getAllWindows())
            w.webContents.send('instances:events', {
              slug: 'smoke',
              op: 'setup:all',
              level: 'warn',
              message: 'Generated code changed after migrate + sync + codegen.',
              at: '2026-06-26T00:00:00.000Z',
            });
        });
        const notice = window.locator('.banner.notice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('Generated code changed');
        await notice.getByRole('button', { name: 'Dismiss' }).click();
        await expect(notice).toHaveCount(0);

        // (2) Loud escalation → non-dismissing modal.
        await app.evaluate(({ BrowserWindow }) => {
          for (const w of BrowserWindow.getAllWindows())
            w.webContents.send('instances:events', {
              slug: 'smoke',
              op: 'setup:escalation',
              level: 'error',
              message: 'Sync still failing after the codegen repair. This needs a human.',
              at: '2026-06-26T00:00:01.000Z',
            });
        });
        const modal = window.locator('.modal.escalation');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText('needs a human');
        // A backdrop click must NOT dismiss it (non-dismissing by design).
        await window.locator('.escalation-backdrop').click({ position: { x: 6, y: 6 } });
        await expect(modal).toBeVisible();
        // Only the explicit Acknowledge button clears it.
        await modal.getByRole('button', { name: 'Acknowledge' }).click();
        await expect(modal).toHaveCount(0);
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
