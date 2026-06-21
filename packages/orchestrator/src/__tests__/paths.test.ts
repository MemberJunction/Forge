import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { resolvePaths } from '../../dist/index.js';

/** Env vars resolvePaths consults — saved/cleared so ambient values don't leak in. */
const ENV_KEYS = [
  'MJDEV_CONFIG_DIR',
  'MJDEV_WORKSPACE_DIR',
  'MJDEV_MJ_REPO',
  'MJDEV_MJ_SOURCE',
  'MJDEV_WORKTREES_DIR',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolvePaths layout', () => {
  it('derives the unified workspace layout from an explicit workspaceRoot', () => {
    const p = resolvePaths({ workspaceRoot: '/ws', configDir: '/cfg' });
    expect(p.workspaceRoot).toBe('/ws');
    expect(p.reposDir).toBe(path.join('/ws', 'repos'));
    expect(p.mjClonePath).toBe(path.join('/ws', 'repos', 'mj'));
    expect(p.instancesRootDir).toBe(path.join('/ws', 'instances'));
    // Worktrees come from the managed clone by default.
    expect(p.mjRepoPath).toBe(p.mjClonePath);
  });

  it('keeps all secrets/state under the hidden configDir, never the workspace', () => {
    const p = resolvePaths({ workspaceRoot: '/ws', configDir: '/cfg' });
    for (const f of [
      p.instancesFile,
      p.secretsFile,
      p.personasFile,
      p.apiKeysFile,
      p.processesFile,
      p.procLogsDir,
    ]) {
      expect(f.startsWith('/cfg')).toBe(true);
      expect(f.startsWith('/ws')).toBe(false);
    }
  });

  it('honors MJDEV_WORKSPACE_DIR', () => {
    process.env.MJDEV_WORKSPACE_DIR = '/env-ws';
    const p = resolvePaths({ configDir: '/cfg' });
    expect(p.workspaceRoot).toBe('/env-ws');
    expect(p.mjClonePath).toBe(path.join('/env-ws', 'repos', 'mj'));
  });

  it('MJDEV_MJ_REPO is a direct-repo escape hatch that bypasses the managed clone', () => {
    process.env.MJDEV_MJ_REPO = '/some/checkout';
    const p = resolvePaths({ workspaceRoot: '/ws', configDir: '/cfg' });
    expect(p.mjRepoPath).toBe('/some/checkout');
    // The managed clone path is still computed (just not used as the repo source).
    expect(p.mjClonePath).toBe(path.join('/ws', 'repos', 'mj'));
    expect(p.mjRepoPath).not.toBe(p.mjClonePath);
  });

  it('seed source defaults are overridable via MJDEV_MJ_SOURCE / options', () => {
    process.env.MJDEV_MJ_SOURCE = '/env-source';
    expect(resolvePaths({ configDir: '/cfg' }).mjSourcePath).toBe('/env-source');
    expect(resolvePaths({ configDir: '/cfg', mjSourcePath: '/opt-source' }).mjSourcePath).toBe(
      '/opt-source'
    );
  });
});
