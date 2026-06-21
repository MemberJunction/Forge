import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { RepoManager } from '../../dist/index.js';

/** Run git in `cwd`, with a deterministic identity so commits work in CI. */
function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@mjdev.local', '-c', 'user.name=mjdev test', ...args],
    { cwd, encoding: 'utf8' }
  ).trim();
}

const GITHUB_URL = 'https://github.com/example/mj.git';
let tmp: string;
let source: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-repo-'));
  // Build a scratch "local checkout" with a default branch, an extra local
  // branch (the thing the clone must preserve), and a GitHub origin url.
  source = path.join(tmp, 'source');
  await fs.mkdir(source, { recursive: true });
  git(source, ['init', '-b', 'main']);
  await fs.writeFile(path.join(source, 'README.md'), '# mj\n');
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'init']);
  git(source, ['branch', 'fix-notifier-injection-bug']);
  git(source, ['remote', 'add', 'origin', GITHUB_URL]);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('RepoManager.ensureCentralClone', () => {
  it('seeds the clone, preserves branches as origin/*, and repoints origin to GitHub', async () => {
    const clonePath = path.join(tmp, 'workspace', 'repos', 'mj');
    await new RepoManager(clonePath, source).ensureCentralClone('test');

    // It is a git repo.
    expect(git(clonePath, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
    // The source's local branch is available as a remote-tracking ref.
    expect(() =>
      git(clonePath, ['rev-parse', '--verify', 'origin/fix-notifier-injection-bug'])
    ).not.toThrow();
    // Origin now points at GitHub, not the local checkout it was seeded from.
    expect(git(clonePath, ['remote', 'get-url', 'origin'])).toBe(GITHUB_URL);
  });

  it('is idempotent — a second call on an existing clone is a no-op', async () => {
    const clonePath = path.join(tmp, 'workspace', 'repos', 'mj');
    const mgr = new RepoManager(clonePath, source);
    await mgr.ensureCentralClone('test');
    const head1 = git(clonePath, ['rev-parse', 'HEAD']);
    await expect(mgr.ensureCentralClone('test')).resolves.toBeUndefined();
    expect(git(clonePath, ['rev-parse', 'HEAD'])).toBe(head1);
  });

  it('throws a clear error when the source checkout is missing', async () => {
    const clonePath = path.join(tmp, 'workspace2', 'repos', 'mj');
    const mgr = new RepoManager(clonePath, path.join(tmp, 'does-not-exist'));
    await expect(mgr.ensureCentralClone('test')).rejects.toThrow(/source checkout/i);
  });
});
