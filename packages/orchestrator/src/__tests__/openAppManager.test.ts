import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenAppManager, DEV_APPS_GLOB, resolvePaths } from '../../dist/index.js';

let tmp: string;
let mgr: OpenAppManager;
let wt: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-openappmgr-'));
  mgr = new OpenAppManager(
    resolvePaths({ workspaceRoot: path.join(tmp, 'ws'), configDir: path.join(tmp, 'cfg') })
  );
  wt = path.join(tmp, 'worktree');
  await fs.mkdir(wt, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

async function readWorkspaces(): Promise<string[]> {
  const pkg = JSON.parse(await fs.readFile(path.join(wt, 'package.json'), 'utf8'));
  return Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces.packages;
}

describe('OpenAppManager.addWorkspaceGlob / removeWorkspaceGlob', () => {
  it('adds the dev-apps glob to an array-form workspaces, idempotently, then removes it', async () => {
    await fs.writeFile(
      path.join(wt, 'package.json'),
      JSON.stringify({ name: 'mj', workspaces: ['packages/*', 'packages/Actions/*'] }, null, 2)
    );

    await mgr.addWorkspaceGlob(wt, DEV_APPS_GLOB);
    expect(await readWorkspaces()).toContain('packages/dev-apps/*');
    // Idempotent — no duplicate.
    await mgr.addWorkspaceGlob(wt, DEV_APPS_GLOB);
    expect((await readWorkspaces()).filter(g => g === 'packages/dev-apps/*').length).toBe(1);
    // Existing globs are preserved.
    expect(await readWorkspaces()).toEqual([
      'packages/*',
      'packages/Actions/*',
      'packages/dev-apps/*',
    ]);

    await mgr.removeWorkspaceGlob(wt, DEV_APPS_GLOB);
    expect(await readWorkspaces()).toEqual(['packages/*', 'packages/Actions/*']);
  });

  it('handles object-form workspaces ({ packages: [...] })', async () => {
    await fs.writeFile(
      path.join(wt, 'package.json'),
      JSON.stringify({ name: 'mj', workspaces: { packages: ['packages/*'] } }, null, 2)
    );
    await mgr.addWorkspaceGlob(wt, DEV_APPS_GLOB);
    const pkg = JSON.parse(await fs.readFile(path.join(wt, 'package.json'), 'utf8'));
    expect(pkg.workspaces.packages).toContain('packages/dev-apps/*');
  });

  it('computes the member path under packages/dev-apps', () => {
    expect(mgr.memberPathFor('/x/mj', 'bizapps-accounting')).toBe(
      path.join('/x/mj', 'packages', 'dev-apps', 'bizapps-accounting')
    );
  });
});
