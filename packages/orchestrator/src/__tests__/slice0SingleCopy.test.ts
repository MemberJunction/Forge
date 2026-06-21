import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEV_APPS_GLOB } from '../../dist/index.js';

/**
 * Slice-0 regression guard for THE core dev-link requirements, on a REALISTIC
 * structure: the open app is its OWN npm workspace (`workspaces:["packages/*"]`)
 * with a publishable sub-package, nested at `packages/dev-apps/<app>` ("Option Y").
 * With the deep `DEV_APPS_GLOB` it must hold that (1) the app sub-package is a host
 * workspace member, (2) MJAPI resolves the app's published name to the LOCAL dev
 * source (parity), and (3) `@scope/core` dedupes to the one host copy. Uses a real
 * `npm install` on local-only packages (no network).
 */
const SCOPE = '@synthmj';
let tmp: string;

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd,
    stdio: 'ignore',
  });
}
async function writeJson(p: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
}
function realResolve(cwd: string, spec: string): string {
  return execFileSync(
    'node',
    ['-e', `process.stdout.write(require('fs').realpathSync(require.resolve('${spec}')))`],
    { cwd, encoding: 'utf8' }
  ).trim();
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-singlecopy-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('Slice 0: single-copy + local-source parity via nested workspace member (Option Y)', () => {
  it('makes the app a member, resolves MJAPI→app to local source, and dedupes @scope/core', async () => {
    // Host MJ workspace: a core pkg + an MJAPI that depends on the app BY NAME
    // (as a real `mj app install` would add it).
    const ws = path.join(tmp, 'host');
    await writeJson(path.join(ws, 'package.json'), {
      name: 'host',
      private: true,
      version: '1.0.0',
      workspaces: ['packages/*', DEV_APPS_GLOB],
    });
    await writeJson(path.join(ws, 'packages/MJCore/package.json'), {
      name: `${SCOPE}/core`,
      version: '5.40.2',
      main: 'index.js',
    });
    await fs.writeFile(path.join(ws, 'packages/MJCore/index.js'), 'module.exports={};\n');
    await writeJson(path.join(ws, 'packages/MJAPI/package.json'), {
      name: `${SCOPE}/api`,
      version: '1.0.0',
      main: 'index.js',
      dependencies: { [`${SCOPE}/core`]: '*', [`${SCOPE}/app-server`]: '*' },
    });
    await fs.writeFile(
      path.join(ws, 'packages/MJAPI/index.js'),
      `require('${SCOPE}/app-server');\n`
    );

    // Open app = its OWN workspace with a publishable sub-package.
    const clone = path.join(tmp, 'app-clone');
    await fs.mkdir(clone, { recursive: true });
    git(clone, ['init', '-b', 'main']);
    await writeJson(path.join(clone, 'package.json'), {
      name: 'the-app',
      private: true,
      version: '1.0.0',
      workspaces: ['packages/*'],
    });
    await writeJson(path.join(clone, 'packages/app-server/package.json'), {
      name: `${SCOPE}/app-server`,
      version: '1.0.0',
      main: 'index.js',
      dependencies: { [`${SCOPE}/core`]: '*' },
    });
    await fs.writeFile(
      path.join(clone, 'packages/app-server/index.js'),
      `module.exports=require('${SCOPE}/core');\n`
    );
    git(clone, ['add', '.']);
    git(clone, ['commit', '-m', 'init']);

    // Option Y: nest the app worktree at the member root inside the host tree.
    const appWt = path.join(ws, 'packages/dev-apps/the-app');
    await fs.mkdir(path.dirname(appWt), { recursive: true });
    git(clone, ['worktree', 'add', appWt, '-b', 'feature/a', 'main']);
    const member = path.join(appWt, 'packages/app-server');

    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore' });

    // (1) app sub-package is a host workspace member.
    await expect(
      fs.access(path.join(ws, 'node_modules', SCOPE, 'app-server'))
    ).resolves.toBeUndefined();
    // (2) MJAPI resolves the app's published name to the LOCAL dev source (parity).
    const appFromApi = realResolve(
      path.join(ws, 'packages/MJAPI'),
      `${SCOPE}/app-server/package.json`
    );
    expect(appFromApi).toBe(path.join(realpathSync(member), 'package.json'));
    // (3) single @scope/core copy shared by MJAPI and the app member.
    const coreFromApi = realResolve(path.join(ws, 'packages/MJAPI'), `${SCOPE}/core/package.json`);
    const coreFromMember = realResolve(member, `${SCOPE}/core/package.json`);
    expect(coreFromMember).toBe(coreFromApi);
    // no nested second copy under the app worktree
    await expect(
      fs.access(path.join(realpathSync(appWt), 'node_modules', SCOPE, 'core'))
    ).rejects.toThrow();
  }, 60_000);
});
