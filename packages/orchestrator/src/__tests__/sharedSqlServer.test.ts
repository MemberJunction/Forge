import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SharedSqlServer, InstanceStore, resolvePaths } from '../../dist/index.js';

/**
 * Mock DockerManager covering only the surface SharedSqlServer.ensure touches:
 * the host-port probe, the create/start primitive, and the readiness wait.
 * Records calls so we can assert ensure() wires the persisted record through.
 */
function fakeDocker(reserved: number[] = []) {
  const calls = { ensure: [] as unknown[], wait: [] as string[] };
  const docker = {
    listPublishedHostPorts: async () => reserved,
    ensureServerContainer: async (opts: unknown) => {
      calls.ensure.push(opts);
      return 'cid-abc123def4567890';
    },
    waitHealthy: async (name: string) => {
      calls.wait.push(name);
    },
  };
  return { docker, calls };
}

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-server-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('SharedSqlServer.ensure', () => {
  it('creates, records, and starts the shared server on first call', async () => {
    const paths = resolvePaths({ configDir: dir, containerPrefix: 'mjdev' });
    const store = new InstanceStore(paths);
    const { docker, calls } = fakeDocker([]);
    const server = new SharedSqlServer(docker as never, store, paths);

    const rec = await server.ensure();

    expect(rec.containerName).toBe('mjdev-sql');
    expect(rec.volume).toBe('mjdev-sql-data');
    expect(rec.port).toBeGreaterThanOrEqual(1433);
    // Shared logins get distinct passwords from sa and each other.
    expect(rec.saPassword).toBeTruthy();
    expect(rec.dbPassword).not.toBe(rec.saPassword);
    expect(rec.codegenPassword).not.toBe(rec.dbPassword);

    // Persisted to server.json, and the container primitive got matching coords.
    expect(await store.getServer()).toEqual(rec);
    expect(calls.ensure[0]).toMatchObject({
      name: 'mjdev-sql',
      volume: 'mjdev-sql-data',
      hostPort: rec.port,
      saPassword: rec.saPassword,
    });
    expect(calls.wait[0]).toBe('mjdev-sql');
  });

  it('is idempotent — reuses the recorded credentials/port on later calls', async () => {
    const paths = resolvePaths({ configDir: dir, containerPrefix: 'mjdev' });
    const store = new InstanceStore(paths);
    const { docker, calls } = fakeDocker([]);
    const server = new SharedSqlServer(docker as never, store, paths);

    const first = await server.ensure();
    const second = await server.ensure();

    expect(second).toEqual(first); // no password churn
    expect(calls.ensure).toHaveLength(2); // still confirms the container each call
  });

  it('uses the prefix-scoped name for the dev workspace and avoids a reserved port', async () => {
    const paths = resolvePaths({ configDir: dir, containerPrefix: 'mjdev-dev' });
    const store = new InstanceStore(paths);
    // Simulate prod already publishing :1433 → dev must land elsewhere.
    const { docker } = fakeDocker([1433]);
    const server = new SharedSqlServer(docker as never, store, paths);

    const rec = await server.ensure();
    expect(rec.containerName).toBe('mjdev-dev-sql');
    expect(rec.volume).toBe('mjdev-dev-sql-data');
    expect(rec.port).not.toBe(1433);
  });
});
