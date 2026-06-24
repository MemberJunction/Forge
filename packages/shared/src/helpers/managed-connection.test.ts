import { describe, it, expect } from 'vitest';
import { buildManagedConnectionProfile, MANAGED_CONNECTION_NAME } from './managed-connection';
import type { ServerRecord } from '../types/instance.types';

const server: ServerRecord = {
  containerName: 'mjdev-sql',
  volume: 'mjdev-sql-data',
  port: 1434,
  saPassword: 'sa-secret',
  dbPassword: 'connect-secret',
  codegenPassword: 'codegen-secret',
};

describe('buildManagedConnectionProfile', () => {
  it('maps a ServerRecord to a managed sa connection on localhost', () => {
    const p = buildManagedConnectionProfile(server);
    expect(p).toMatchObject({
      name: MANAGED_CONNECTION_NAME,
      engine: 'mssql',
      server: 'localhost',
      port: 1434,
      authenticationType: 'sql',
      username: 'sa',
      encrypt: false,
      trustServerCertificate: true,
      managed: true,
    });
    // Server-level connection — no default database, so all MJ_* DBs are visible.
    expect(p.database).toBeUndefined();
    // Password is never embedded in the profile (it goes to the keychain).
    expect((p as Record<string, unknown>).saPassword).toBeUndefined();
    expect((p as Record<string, unknown>).password).toBeUndefined();
  });

  it('preserves user-edited name and color across a reconcile', () => {
    const p = buildManagedConnectionProfile(server, { name: 'My Dev DB', color: '#ff0' });
    expect(p.name).toBe('My Dev DB');
    expect(p.color).toBe('#ff0');
    // Host/port/credentials are still re-derived from the record.
    expect(p.port).toBe(1434);
    expect(p.username).toBe('sa');
    expect(p.managed).toBe(true);
  });

  it('tracks a changed server port', () => {
    expect(buildManagedConnectionProfile({ ...server, port: 1455 }).port).toBe(1455);
  });
});
