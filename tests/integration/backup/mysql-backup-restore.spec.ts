/**
 * MySQL backup/restore round-trip — integration test.
 *
 * Same shape as the PG round-trip: spawn `mysqldump` to capture the
 * database, drop the verification table, pipe the dump file into the
 * `mysql` CLI to restore, and re-query to confirm the rows came back.
 * Exercises the real client tools against the test MySQL container, so
 * this fails fast if mysqldump/mysql aren't on PATH or the service
 * regresses on argument handling, env vars, or progress reporting.
 *
 * The same electron + connection-profiles mocking pattern as the PG
 * spec — see backup-ipc-capture.ts for how completion events are
 * captured and awaited.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mysql from 'mysql2/promise';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { ipcCapture, waitForOperation } from '../../helpers/backup-ipc-capture';
import { withFreshDatabase } from '../../helpers/db-fixtures';

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

import { MySQLBackupService } from '@mj-forge/main/services/sql/mysql-backup';

describe('mysql backup/restore round-trip', () => {
  const tmpFiles: string[] = [];

  beforeEach(() => {
    ipcCapture.reset();
    fakeProfiles.clear();
    fakePasswords.clear();
    MySQLBackupService.resetInstance();
  });

  afterAll(async () => {
    for (const path of tmpFiles) {
      await rm(path, { force: true }).catch(() => {});
    }
  });

  it('backs up a seeded table, drops it, restores from the dump, and recovers all rows', async () => {
    await withFreshDatabase('mysql', async db => {
      const c = db.config;

      const seedConn = await mysql.createConnection({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
        multipleStatements: true,
      });
      try {
        await seedConn.query('CREATE TABLE foo (id INT PRIMARY KEY, name VARCHAR(64) NOT NULL)');
        await seedConn.query(
          "INSERT INTO foo (id, name) VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma')"
        );
      } finally {
        await seedConn.end();
      }

      const connectionId = randomUUID();
      fakeProfiles.set(connectionId, {
        id: connectionId,
        engine: 'mysql',
        server: c.host,
        port: c.port,
        username: c.user,
      });
      fakePasswords.set(connectionId, c.password);

      const backupPath = join(tmpdir(), `forge-mysql-backup-${connectionId}.sql`);
      tmpFiles.push(backupPath);

      const service = MySQLBackupService.getInstance();

      const backupOpId = await service.startBackup({
        connectionId,
        database: c.database,
        backupPath,
        backupType: 'full',
      });
      expect(backupOpId).toMatch(/^[0-9a-f-]{36}$/i);

      const backupResult = await waitForOperation(ipcCapture, backupOpId);
      expect(backupResult.success, `backup failed: ${backupResult.error}`).toBe(true);

      // Drop foo so the restore has work to do — the mysqldump output
      // contains DROP TABLE / CREATE TABLE for `foo` (the service uses
      // `--add-drop-table`), so re-running it on an existing schema is
      // idempotent and doesn't need a `replaceExisting` flag.
      const dropConn = await mysql.createConnection({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
      });
      try {
        await dropConn.query('DROP TABLE foo');
      } finally {
        await dropConn.end();
      }

      const restoreOpId = await service.startRestore({
        connectionId,
        backupPath,
        targetDatabase: c.database,
      });
      expect(restoreOpId).toMatch(/^[0-9a-f-]{36}$/i);

      const restoreResult = await waitForOperation(ipcCapture, restoreOpId);
      expect(restoreResult.success, `restore failed: ${restoreResult.error}`).toBe(true);

      const verifyConn = await mysql.createConnection({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
      });
      try {
        const [rows] = await verifyConn.query<mysql.RowDataPacket[]>(
          'SELECT id, name FROM foo ORDER BY id'
        );
        expect(rows).toEqual([
          { id: 1, name: 'alpha' },
          { id: 2, name: 'beta' },
          { id: 3, name: 'gamma' },
        ]);
      } finally {
        await verifyConn.end();
      }
    });
  }, 60_000);

  // Regression: MySQL CLI rejects connecting with a non-existent default
  // database (ERROR 1049 (42000): Unknown database 'X'). startRestore used
  // to pass the target db as a positional arg, which made the CLI fail
  // before the dump could create the target. The fix prepends
  // CREATE DATABASE IF NOT EXISTS / USE to the dump stream so a new target
  // is created on the fly. This test fails without that fix.
  it('restores into a target database that does not yet exist', async () => {
    await withFreshDatabase('mysql', async db => {
      const c = db.config;

      const seedConn = await mysql.createConnection({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: c.database,
      });
      try {
        await seedConn.query('CREATE TABLE bar (id INT PRIMARY KEY, label VARCHAR(32) NOT NULL)');
        await seedConn.query("INSERT INTO bar (id, label) VALUES (1, 'one'), (2, 'two')");
      } finally {
        await seedConn.end();
      }

      const connectionId = randomUUID();
      fakeProfiles.set(connectionId, {
        id: connectionId,
        engine: 'mysql',
        server: c.host,
        port: c.port,
        username: c.user,
      });
      fakePasswords.set(connectionId, c.password);

      const backupPath = join(tmpdir(), `forge-mysql-newdb-${connectionId}.sql`);
      tmpFiles.push(backupPath);

      const service = MySQLBackupService.getInstance();

      const backupOpId = await service.startBackup({
        connectionId,
        database: c.database,
        backupPath,
        backupType: 'full',
      });
      const backupResult = await waitForOperation(ipcCapture, backupOpId);
      expect(backupResult.success, `backup failed: ${backupResult.error}`).toBe(true);

      // Restore into a database name that doesn't exist yet on the server.
      const newDb = `forge_restore_${randomUUID().slice(0, 8).replace(/-/g, '')}`;

      const restoreOpId = await service.startRestore({
        connectionId,
        backupPath,
        targetDatabase: newDb,
      });
      const restoreResult = await waitForOperation(ipcCapture, restoreOpId);
      expect(restoreResult.success, `restore failed: ${restoreResult.error}`).toBe(true);

      const verifyConn = await mysql.createConnection({
        host: c.host,
        port: c.port,
        user: c.user,
        password: c.password,
        database: newDb,
      });
      try {
        const [rows] = await verifyConn.query<mysql.RowDataPacket[]>(
          'SELECT id, label FROM bar ORDER BY id'
        );
        expect(rows).toEqual([
          { id: 1, label: 'one' },
          { id: 2, label: 'two' },
        ]);
      } finally {
        await verifyConn.end();
        // Clean up the side-effect database the test created.
        const cleanupConn = await mysql.createConnection({
          host: c.host,
          port: c.port,
          user: c.user,
          password: c.password,
        });
        try {
          await cleanupConn.query(`DROP DATABASE IF EXISTS \`${newDb}\``);
        } finally {
          await cleanupConn.end();
        }
      }
    });
  }, 60_000);

  it('rejects target database names that contain unsafe characters', async () => {
    const connectionId = randomUUID();
    fakeProfiles.set(connectionId, {
      id: connectionId,
      engine: 'mysql',
      server: '127.0.0.1',
      port: 13306,
      username: 'forge',
    });
    fakePasswords.set(connectionId, 'forge');

    const service = MySQLBackupService.getInstance();

    await expect(
      service.startRestore({
        connectionId,
        backupPath: '/tmp/whatever.sql',
        targetDatabase: 'evil; DROP DATABASE prod; --',
      })
    ).rejects.toThrow(/Invalid target database name/);
  });
});
