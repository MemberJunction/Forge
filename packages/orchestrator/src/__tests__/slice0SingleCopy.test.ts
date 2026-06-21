import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Slice-0 regression guard for THE core dev-link risk: a per-instance app worktree
 * nested DIRECTLY at the workspace member path ("Option Y") must dedupe a scoped
 * dependency to the single host copy. (A symlinked external member fails — proven
 * by the scratch probe; Option Y is the chosen mechanism.) Uses a synthetic
 * MJ-like workspace + a real `npm install` (local-only packages, no network).
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
/** realpath of @synthmj/core/package.json as resolved from `cwd`. */
function resolveCoreFrom(cwd: string): string {
  return execFileSync(
    'node',
    [
      '-e',
      `process.stdout.write(require('fs').realpathSync(require.resolve('${SCOPE}/core/package.json')))`,
    ],
    { cwd, encoding: 'utf8' }
  ).trim();
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-singlecopy-'));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('Slice 0: single-copy via nested workspace member (Option Y)', () => {
  it('dedupes @scope/* to the one host copy for both the host app and the dev-linked app', async () => {
    // Synthetic host MJ workspace: a core pkg + an MJAPI consumer.
    const ws = path.join(tmp, 'host');
    await writeJson(path.join(ws, 'package.json'), {
      name: 'host',
      private: true,
      version: '1.0.0',
      workspaces: ['packages/*', 'packages/dev-apps/*'],
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
      dependencies: { [`${SCOPE}/core`]: '*' },
    });
    await fs.writeFile(path.join(ws, 'packages/MJAPI/index.js'), `require('${SCOPE}/core');\n`);

    // A separate "open app" clone with a sub-package depending on @scope/core.
    const clone = path.join(tmp, 'app-clone');
    await fs.mkdir(clone, { recursive: true });
    git(clone, ['init', '-b', 'main']);
    await writeJson(path.join(clone, 'packages/app-server/package.json'), {
      name: `${SCOPE}/app-server`,
      version: '1.0.0',
      main: 'index.js',
      dependencies: { [`${SCOPE}/core`]: '*' },
    });
    await fs.writeFile(
      path.join(clone, 'packages/app-server/index.js'),
      `require('${SCOPE}/core');\n`
    );
    git(clone, ['add', '.']);
    git(clone, ['commit', '-m', 'init']);

    // Option Y: cut the app worktree directly at the member path inside the host.
    const appWt = path.join(ws, 'packages/dev-apps/_app');
    await fs.mkdir(path.dirname(appWt), { recursive: true });
    git(clone, ['worktree', 'add', appWt, '-b', 'feature/a', 'main']);
    const member = path.join(appWt, 'packages/app-server');

    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ws, stdio: 'ignore' });

    const fromApi = resolveCoreFrom(path.join(ws, 'packages/MJAPI'));
    const fromMember = resolveCoreFrom(member);
    expect(fromMember).toBe(fromApi); // single copy — same resolved file

    // And no nested second copy under the member.
    const nested = path.join(realpathSync(member), 'node_modules', SCOPE);
    await expect(fs.access(nested)).rejects.toThrow();
  }, 60_000);
});
