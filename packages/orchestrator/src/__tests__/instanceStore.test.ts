import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { InstanceStore, resolvePaths } from '../../dist/index.js';
import type { InstanceRecord, InstanceSecrets } from '@mj-forge/shared';

function makeRecord(slug: string): InstanceRecord {
  return {
    id: slug,
    slug,
    name: slug,
    branch: `mjdev/${slug}`,
    worktreePath: `/tmp/${slug}`,
    container: { name: `mjdev-${slug}`, volume: `mjdev-${slug}-data` },
    ports: { sql: 1433, api: 4000, explorer: 4200 },
    dbName: `MJ_${slug}`,
    secretsRef: slug,
    status: 'stopped',
    setup: {
      configWritten: true,
      depsInstalled: false,
      migrated: false,
      codegen: false,
      built: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

let dir: string;
let store: InstanceStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-test-'));
  store = new InstanceStore(resolvePaths({ configDir: dir }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('InstanceStore records', () => {
  it('returns empty list before anything is written', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('upserts, gets, and removes records', async () => {
    await store.upsert(makeRecord('alpha'));
    await store.upsert(makeRecord('beta'));
    expect((await store.list()).map(r => r.slug).sort()).toEqual(['alpha', 'beta']);
    expect((await store.get('alpha'))?.slug).toBe('alpha');

    const updated = { ...makeRecord('alpha'), status: 'running' as const };
    await store.upsert(updated);
    expect((await store.get('alpha'))?.status).toBe('running');
    expect(await store.list()).toHaveLength(2);

    await store.remove('alpha');
    expect(await store.get('alpha')).toBeUndefined();
    expect(await store.list()).toHaveLength(1);
  });
});

describe('InstanceStore secrets', () => {
  it('round-trips and deletes secrets', async () => {
    const secrets: InstanceSecrets = {
      saPassword: 'pw',
      dbUsername: 'sa',
      dbPassword: 'pw',
      codegenUsername: 'sa',
      codegenPassword: 'pw',
    };
    await store.setSecrets('alpha', secrets);
    expect(await store.getSecrets('alpha')).toEqual(secrets);
    await store.deleteSecrets('alpha');
    expect(await store.getSecrets('alpha')).toBeUndefined();
  });
});

describe('InstanceStore YAML config', () => {
  it('round-trips a config', async () => {
    await store.writeConfig('alpha', { name: 'Alpha', branch: 'feature/a' });
    const cfg = await store.readConfig('alpha');
    expect(cfg?.name).toBe('Alpha');
    expect(cfg?.branch).toBe('feature/a');
  });

  it('parseConfigFile rejects a config without a name', async () => {
    const file = path.join(dir, 'bad.yaml');
    await fs.writeFile(file, 'branch: x\n');
    await expect(InstanceStore.parseConfigFile(file)).rejects.toThrow(/name/);
  });

  it('parseConfigFile reads a valid config', async () => {
    const file = path.join(dir, 'good.yaml');
    await fs.writeFile(file, 'name: Gamma\nbranch: feature/g\n');
    const cfg = await InstanceStore.parseConfigFile(file);
    expect(cfg.name).toBe('Gamma');
  });
});
