import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppRepoManager } from '../../dist/index.js';

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@mjdev.local', '-c', 'user.name=mjdev test', ...args],
    { cwd, encoding: 'utf8' }
  ).trim();
}

const APP_URL = 'https://github.com/MemberJunction/mj-sample-open-app.git';
let tmp: string;
let appsReposDir: string;
let source: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-apprepo-'));
  appsReposDir = path.join(tmp, 'repos', 'apps');
  // A scratch "local app checkout" with an extra branch + a GitHub origin.
  source = path.join(tmp, 'source-app');
  await fs.mkdir(source, { recursive: true });
  git(source, ['init', '-b', 'main']);
  await fs.writeFile(path.join(source, 'mj-app.json'), '{"name":"sample"}\n');
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'init']);
  git(source, ['branch', 'feature/x']);
  git(source, ['remote', 'add', 'origin', APP_URL]);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('AppRepoManager.appDirName', () => {
  it('derives a safe dir name from URLs and paths', () => {
    expect(AppRepoManager.appDirName('https://github.com/MemberJunction/mj-sample-open-app')).toBe(
      'mj-sample-open-app'
    );
    expect(
      AppRepoManager.appDirName('https://github.com/MemberJunction/mj-sample-open-app.git')
    ).toBe('mj-sample-open-app');
    expect(AppRepoManager.appDirName('git@github.com:Org/bizapps-accounting.git')).toBe(
      'bizapps-accounting'
    );
    expect(AppRepoManager.appDirName('/Users/me/projects/myapp/')).toBe('myapp');
  });
});

describe('AppRepoManager.ensureAppClone', () => {
  it('clones from a local checkout, repoints origin, and is idempotent', async () => {
    const mgr = new AppRepoManager(appsReposDir);
    const clonePath = await mgr.ensureAppClone(source);
    expect(clonePath).toBe(path.join(appsReposDir, 'source-app'));
    expect(git(clonePath, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
    expect(git(clonePath, ['remote', 'get-url', 'origin'])).toBe(APP_URL);

    const head1 = git(clonePath, ['rev-parse', 'HEAD']);
    await mgr.ensureAppClone(source); // idempotent — no throw, same HEAD
    expect(git(clonePath, ['rev-parse', 'HEAD'])).toBe(head1);
  });

  it('checks out a requested branch', async () => {
    const mgr = new AppRepoManager(appsReposDir);
    const clonePath = await mgr.ensureAppClone(source, { branch: 'feature/x' });
    expect(git(clonePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature/x');
  });
});

describe('AppRepoManager — Option Y: nested per-instance app worktrees (parallel branches, git-clean)', () => {
  it('cuts each instance its own app worktree/branch inside its MJ tree, hidden from git', async () => {
    const mgr = new AppRepoManager(appsReposDir);
    const clonePath = await mgr.ensureAppClone(source); // ONE shared app clone (object store)

    // Two MJ instance worktrees (linked off a host MJ repo) — like two instances.
    const mjHost = path.join(tmp, 'mjhost');
    await fs.mkdir(mjHost, { recursive: true });
    git(mjHost, ['init', '-b', 'main']);
    await fs.writeFile(
      path.join(mjHost, 'package.json'),
      '{"name":"mj","workspaces":["packages/*"]}\n'
    );
    git(mjHost, ['add', '.']);
    git(mjHost, ['commit', '-m', 'init']);
    const instA = path.join(tmp, 'instA', 'mj');
    const instB = path.join(tmp, 'instB', 'mj');
    git(mjHost, ['worktree', 'add', instA, '-b', 'mjdev/a']);
    git(mjHost, ['worktree', 'add', instB, '-b', 'mjdev/b']);

    // Hide the member root, then cut each app worktree DIRECTLY at it (Option Y),
    // on its OWN branch off the shared clone (parallel feature dev of one app).
    await mgr.addWorktreeExclude(instA, 'packages/dev-apps/');
    await mgr.addWorktreeExclude(instB, 'packages/dev-apps/');
    const memberA = path.join(instA, 'packages', 'dev-apps', 'sample');
    const memberB = path.join(instB, 'packages', 'dev-apps', 'sample');
    git(clonePath, ['worktree', 'add', memberA, '-b', 'feature/a', 'main']);
    git(clonePath, ['worktree', 'add', memberB, '-b', 'feature/b', 'main']);

    // Independent branches + edit independence per instance.
    expect(git(memberA, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature/a');
    expect(git(memberB, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('feature/b');
    await fs.writeFile(path.join(memberA, 'mj-app.json'), '{"name":"A"}\n');
    expect(await fs.readFile(path.join(memberB, 'mj-app.json'), 'utf8')).not.toContain(
      '"name":"A"'
    );

    // The nested app worktree (a .git gitlink) is INVISIBLE to the MJ worktree's
    // git via .git/info/exclude — never staged as an embedded repo.
    expect(git(instA, ['status', '--porcelain'])).not.toContain('packages/dev-apps');
  });
});

describe('AppRepoManager.addWorktreeExclude', () => {
  it('excludes a pattern via the common-dir info/exclude so git status hides it', async () => {
    // A host repo + a linked worktree (mirrors how instances are created).
    const host = path.join(tmp, 'host');
    await fs.mkdir(host, { recursive: true });
    git(host, ['init', '-b', 'main']);
    await fs.writeFile(path.join(host, 'README.md'), '# host\n');
    git(host, ['add', '.']);
    git(host, ['commit', '-m', 'init']);
    const wt = path.join(tmp, 'wt-linked');
    git(host, ['worktree', 'add', wt, '-b', 'mjdev/x']);

    const mgr = new AppRepoManager(appsReposDir);
    await mgr.addWorktreeExclude(wt, 'packages/dev-apps/');
    await mgr.addWorktreeExclude(wt, 'packages/dev-apps/'); // idempotent

    // Written to the COMMON dir (where git actually reads exclude for a linked
    // worktree), exactly once.
    const commonDir = git(wt, ['rev-parse', '--git-common-dir']);
    const abs = path.isAbsolute(commonDir) ? commonDir : path.resolve(wt, commonDir);
    const exclude = await fs.readFile(path.join(abs, 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n').filter(l => l.trim() === 'packages/dev-apps/').length).toBe(1);

    // It actually takes effect: a dir matching the pattern is hidden from status.
    await fs.mkdir(path.join(wt, 'packages', 'dev-apps', 'x'), { recursive: true });
    await fs.writeFile(path.join(wt, 'packages', 'dev-apps', 'x', 'f.txt'), 'hi\n');
    expect(git(wt, ['status', '--porcelain'])).not.toContain('dev-apps');

    // The tracked .gitignore is untouched.
    await expect(fs.readFile(path.join(wt, '.gitignore'), 'utf8')).rejects.toThrow();
  });
});
