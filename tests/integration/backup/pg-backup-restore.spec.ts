/**
 * PostgreSQL backup/restore round-trip — integration test.
 *
 * Pins the contract that PgBackupService.startBackup followed by
 * PgBackupService.startRestore returns the database to its pre-drop state.
 * Exercises the real `pg_dump` / `pg_restore` CLIs against the test PG
 * container, so this fails fast if the CLI tools aren't on PATH or the
 * service drops them on the floor.
 *
 * The service signals completion via BrowserWindow.getAllWindows() IPC,
 * which doesn't exist in a Node-only Vitest run. We mock `electron` with
 * a fake window that captures every send() into a buffer, then await the
 * completion event for a given operationId. The mock for
 * `connection-profiles` substitutes a controllable profile/password store
 * so the test owns those values without touching electron-store / keytar.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client as PgClient } from 'pg';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { ipcCapture, waitForOperation } from '../../helpers/backup-ipc-capture';
import { withFreshDatabase } from '../../helpers/db-fixtures';

// vi.mock calls are hoisted, so they take effect before the SUT import below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeProfiles: Map<string, any> = new Map();
const fakePasswords: Map<string, string> = new Map();

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: { send: ipcCapture.send },
      },
    ],
  },
}));

vi.mock('@mj-forge/main/services/config/connection-profiles', () => ({
  ConnectionProfilesStore: {
    getInstance: () => ({
      getById: (id: string) => fakeProfiles.get(id),
      getPassword: async (id: string) => fakePasswords.get(id) ?? null,
    }),
  },
}));

// Import AFTER mocks so the service constructor sees the fake store.
import { PgBackupService } from '@mj-forge/main/services/sql/pg-backup';

describe('postgres backup/restore round-trip', () => {
  const tmpFiles: string[] = [];

  beforeEach(() => {
    ipcCapture.reset();
    fakeProfiles.clear();
    fakePasswords.clear();
    // Force a fresh service instance per test so the activeOperations Map
    // doesn't leak state between cases.
    PgBackupService.resetInstance();
  });

  afterAll(async () => {
    for (const path of tmpFiles) {
      await rm(path, { force: true }).catch(() => {});
    }
  });

  it('backs up a seeded table, drops it, restores from the dump, and recovers all rows', async () => {
    await withFreshDatabase('postgres', async db => {
      const c = db.config;

      const seedClient = new PgClient({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
      });
      await seedClient.connect();
      try {
        await seedClient.query('CREATE TABLE foo (id INT PRIMARY KEY, name TEXT NOT NULL)');
        await seedClient.query(
          "INSERT INTO foo (id, name) VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma')"
        );
      } finally {
        await seedClient.end();
      }

      const connectionId = randomUUID();
      fakeProfiles.set(connectionId, {
        id: connectionId,
        engine: 'postgresql',
        server: c.host,
        port: c.port,
        username: c.user,
      });
      fakePasswords.set(connectionId, c.password);

      const backupPath = join(tmpdir(), `forge-pg-backup-${connectionId}.dump`);
      tmpFiles.push(backupPath);

      const service = PgBackupService.getInstance();

      const backupOpId = await service.startBackup({
        connectionId,
        database: c.database,
        backupPath,
        backupType: 'full',
      });
      expect(backupOpId).toMatch(/^[0-9a-f-]{36}$/i);

      const backupResult = await waitForOperation(ipcCapture, backupOpId);
      expect(backupResult).toEqual({ success: true, error: undefined });

      // Drop the table — the restore must put it back.
      const dropClient = new PgClient({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
      });
      await dropClient.connect();
      try {
        await dropClient.query('DROP TABLE foo');
      } finally {
        await dropClient.end();
      }

      // `withFreshDatabase` applies the synthetic e-commerce schema on
      // creation, so the dump contains both that schema AND our `foo`
      // table. Without `replaceExisting`, pg_restore hits "constraint
      // already exists" errors on the existing FKs. The flag wires up
      // `--clean --if-exists`, matching how a real user would restore
      // over an existing database.
      const restoreOpId = await service.startRestore({
        connectionId,
        backupPath,
        targetDatabase: c.database,
        replaceExisting: true,
      });
      expect(restoreOpId).toMatch(/^[0-9a-f-]{36}$/i);

      const restoreResult = await waitForOperation(ipcCapture, restoreOpId);
      expect(restoreResult.success, `restore failed: ${restoreResult.error}`).toBe(true);

      const verifyClient = new PgClient({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
      });
      await verifyClient.connect();
      try {
        const r = await verifyClient.query<{ id: number; name: string }>(
          'SELECT id, name FROM foo ORDER BY id'
        );
        expect(r.rows).toEqual([
          { id: 1, name: 'alpha' },
          { id: 2, name: 'beta' },
          { id: 3, name: 'gamma' },
        ]);
      } finally {
        await verifyClient.end();
      }
    });
  }, 60_000);
});
