/**
 * GUI e2e: the "Open in VS Code" button opens the multi-root `.code-workspace`
 * (not the bare folder) once an app is dev-linked, and the per-app navigation
 * symlink is materialized — both reconciled as a side effect of opening.
 *
 * Deterministic + Docker-free: seed instances.json/openapps.json into an
 * isolated MJDEV_CONFIG_DIR and a real MJDEV_WORKSPACE_DIR with the instance's
 * `mj/packages/dev-apps/<app>` member on disk, so the engine reconciles against
 * a real instance dir. The actual editor launch is skipped under FORGE_TEST.
 */

import { test, expect } from '@playwright/test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  lstatSync,
  readlinkSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withForge } from '../helpers/electron-app';
import { seedInstance, seedOpenApps } from '../helpers/mjdev-seed';

const IGNORE = ['favicon', 'ResizeObserver', 'Autofill.enable', 'devtools'];

test('Open in VS Code reconciles + opens the multi-root workspace for a dev-linked instance', async () => {
  const configDir = mkdtempSync(join(tmpdir(), 'mjdev-ws-cfg-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'mjdev-ws-root-'));
  const slug = 'wstest';
  const app = 'bizapps-accounting';

  // Real instance dir + nested app member the symlink/workspace root point at.
  const worktreePath = join(workspaceDir, 'instances', slug, 'mj');
  mkdirSync(join(worktreePath, 'packages', 'dev-apps', app), { recursive: true });

  seedInstance(configDir, { slug, name: 'WS Test', built: true, worktreePath });
  seedOpenApps(configDir, slug, { app, mode: 'dev' });

  const instanceDir = join(workspaceDir, 'instances', slug);
  const wsFile = join(instanceDir, `${slug}.code-workspace`);
  const symlink = join(instanceDir, app);

  try {
    await withForge(
      {
        envOverrides: { MJDEV_CONFIG_DIR: configDir, MJDEV_WORKSPACE_DIR: workspaceDir },
        failOnError: true,
        ignoreErrors: IGNORE,
      },
      async ({ window }) => {
        await window.getByText('MJ Dev Manager', { exact: true }).click();
        await expect(window.getByRole('heading', { name: /Instances/ })).toBeVisible();

        // Select the seeded instance so the detail panel (with the VS Code button) shows.
        await window.locator('.list li', { hasText: 'WS Test' }).click();
        const vscodeBtn = window.getByRole('button', { name: /VS Code/ });
        await expect(vscodeBtn).toBeVisible();

        // BEHAVIOR: clicking reconciles artifacts and resolves to the workspace file.
        await vscodeBtn.click();
        await expect.poll(() => existsSync(wsFile), { timeout: 5000 }).toBe(true);

        // Authoritative: the IPC returns the .code-workspace path (workspace, not folder).
        const result = await window.evaluate(
          (s: string) =>
            (
              window as unknown as {
                forge: { instances: { openInVSCode: (x: string) => Promise<{ path: string }> } };
              }
            ).forge.instances.openInVSCode(s),
          slug
        );
        expect(result.path).toBe(wsFile);
      }
    );

    // Workspace lists MJ core + the dev-linked app at its real nested path.
    const ws = JSON.parse(readFileSync(wsFile, 'utf-8'));
    expect(ws.folders.map((f: { path: string }) => f.path)).toEqual([
      'mj',
      `mj/packages/dev-apps/${app}`,
    ]);

    // Per-app navigation symlink materialized and resolves to the member.
    expect(lstatSync(symlink).isSymbolicLink()).toBe(true);
    expect(readlinkSync(symlink)).toBe(`mj/packages/dev-apps/${app}`);
    expect(existsSync(symlink)).toBe(true);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
