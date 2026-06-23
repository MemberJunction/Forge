import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorktreeManager } from '../../dist/index.js';

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@mjdev.local', '-c', 'user.name=mjdev test', ...args],
    { cwd, encoding: 'utf8' }
  ).trim();
}

let tmp: string;
let clone: string;
let wt: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-merge-'));
  // A "clone" with a base branch, then an instance branch in its own worktree
  // off that base — exactly the shape a real instance has.
  clone = path.join(tmp, 'clone');
  await fs.mkdir(clone, { recursive: true });
  git(clone, ['init', '-b', 'base']);
  await fs.writeFile(path.join(clone, 'f.txt'), 'v1\n');
  git(clone, ['add', '.']);
  git(clone, ['commit', '-m', 'base v1']);
  wt = path.join(tmp, 'wt');
  git(clone, ['worktree', 'add', '-b', 'feature', wt, 'base']);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('WorktreeManager.mergeBaseRef', () => {
  it('merges new base-branch commits into the worktree branch', async () => {
    await fs.writeFile(path.join(clone, 'g.txt'), 'new\n');
    git(clone, ['add', '.']);
    git(clone, ['commit', '-m', 'base v2']);

    const r = await new WorktreeManager(clone).mergeBaseRef(wt, 'base');
    expect(r.updated).toBe(true);
    // The new base commit's file is now in the instance worktree.
    expect(existsSync(path.join(wt, 'g.txt'))).toBe(true);
  });

  it('is a no-op when already up to date with base', async () => {
    const r = await new WorktreeManager(clone).mergeBaseRef(wt, 'base');
    expect(r.updated).toBe(false);
  });

  it('aborts cleanly on conflict, never leaving a half-merged tree', async () => {
    await fs.writeFile(path.join(clone, 'f.txt'), 'base-change\n');
    git(clone, ['add', '.']);
    git(clone, ['commit', '-m', 'base conflict']);
    await fs.writeFile(path.join(wt, 'f.txt'), 'feature-change\n');
    git(wt, ['add', '.']);
    git(wt, ['commit', '-m', 'feature conflict']);

    await expect(new WorktreeManager(clone).mergeBaseRef(wt, 'base')).rejects.toThrow(
      /conflict|aborted/i
    );
    // No lingering MERGE_HEAD — the worktree is back to a clean state.
    expect(() => git(wt, ['rev-parse', '--verify', 'MERGE_HEAD'])).toThrow();
  });
});

describe('WorktreeManager.pull', () => {
  it('reports a clear no-op when the branch has no remote upstream', async () => {
    const r = await new WorktreeManager(clone).pull(wt);
    expect(r.updated).toBe(false);
    expect(r.message).toMatch(/no remote upstream/i);
  });
});
