/**
 * The MJ Dev Manager auto-registers a Forge connection for the shared SQL Server
 * on launch (reads ~/.mjdev/server.json → upserts a managed ConnectionProfile),
 * so the server + all its instance databases appear in the connection list with
 * no manual setup. Verified through the REAL main-process startup (not a mock):
 * seed a server.json, launch Forge, assert the connection persisted.
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withForge } from '../helpers/electron-app';

const IGNORE = ['favicon', 'ResizeObserver', 'Autofill', 'devtools'];

test('auto-registers a managed connection for the shared SQL Server on launch', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'mjdev-cfg-'));
  // Seed a shared-server record. The reconciler only REGISTERS a profile (it never
  // connects), so a throwaway port/passwords are fine and touch nothing real.
  writeFileSync(
    join(cfg, 'server.json'),
    JSON.stringify({
      containerName: 'mjdev-sql',
      volume: 'mjdev-sql-data',
      port: 14999,
      saPassword: 'sa-test-pw',
      dbPassword: 'connect-test-pw',
      codegenPassword: 'codegen-test-pw',
    })
  );

  try {
    await withForge(
      { envOverrides: { MJDEV_CONFIG_DIR: cfg }, failOnError: true, ignoreErrors: IGNORE },
      async ({ window, userDataDir }) => {
        // The reconcile runs in app.whenReady (before the window); give the
        // keychain-backed save a beat to flush to the connections store.
        await window.waitForTimeout(750);

        const connFile = join(userDataDir, 'connections.json');
        expect(existsSync(connFile), 'connections store should exist').toBe(true);
        const store = JSON.parse(readFileSync(connFile, 'utf8'));
        const profiles = store.profiles ?? [];

        const managed = profiles.filter((p: { managed?: boolean }) => p.managed);
        expect(managed.length, 'exactly one managed connection').toBe(1);
        expect(managed[0]).toMatchObject({
          name: 'MJ Dev (shared SQL Server)',
          engine: 'mssql',
          server: 'localhost',
          port: 14999,
          authenticationType: 'sql',
          username: 'sa',
          managed: true,
        });
        // The sa password must never be embedded in the profile (keychain only).
        expect(managed[0].password).toBeUndefined();
        expect(managed[0].saPassword).toBeUndefined();
      }
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});

test('registers nothing when there is no shared server yet', async () => {
  const cfg = mkdtempSync(join(tmpdir(), 'mjdev-cfg-empty-'));
  try {
    await withForge(
      { envOverrides: { MJDEV_CONFIG_DIR: cfg }, failOnError: true, ignoreErrors: IGNORE },
      async ({ window, userDataDir }) => {
        await window.waitForTimeout(500);
        const connFile = join(userDataDir, 'connections.json');
        const profiles = existsSync(connFile)
          ? (JSON.parse(readFileSync(connFile, 'utf8')).profiles ?? [])
          : [];
        expect(profiles.some((p: { managed?: boolean }) => p.managed)).toBe(false);
      }
    );
  } finally {
    rmSync(cfg, { recursive: true, force: true });
  }
});
