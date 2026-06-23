import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run, runOrThrow } from './exec.js';
import { emit, type EventSink, noopSink } from './util.js';

/**
 * Manages git worktrees off the MJ repository — one per instance. Never deletes
 * branches (data-safety); only removes the worktree directory.
 */
export class WorktreeManager {
  constructor(private readonly mjRepoPath: string) {}

  private git(args: string[], onOutput?: (s: string) => void) {
    return runOrThrow('git', ['-C', this.mjRepoPath, ...args], { onOutput });
  }

  /** True when `ref` resolves to an existing branch/commit in the repo. */
  private async refExists(ref: string): Promise<boolean> {
    const r = await run('git', ['-C', this.mjRepoPath, 'rev-parse', '--verify', '--quiet', ref]);
    return r.code === 0;
  }

  private async branchExists(branch: string): Promise<boolean> {
    return this.refExists(`refs/heads/${branch}`);
  }

  /**
   * Resolve a new branch's start point. A freshly-seeded central clone has the
   * source checkout's branches only as remote-tracking refs, so a bare name
   * like `fix-notifier-injection-bug` won't resolve — fall back to
   * `origin/<ref>` when the local name is absent. Returns `baseRef` unchanged
   * otherwise (and lets git surface its own clear error for a bad ref).
   */
  private async resolveBaseRef(baseRef: string): Promise<string> {
    if (await this.refExists(baseRef)) return baseRef;
    if (await this.refExists(`refs/remotes/origin/${baseRef}`)) return `origin/${baseRef}`;
    return baseRef;
  }

  private async head(worktreePath: string): Promise<string> {
    return (await runOrThrow('git', ['-C', worktreePath, 'rev-parse', 'HEAD'])).stdout.trim();
  }

  /**
   * Pull the worktree's current branch from its remote upstream (fast-forward only —
   * never creates a merge commit or leaves a conflicted tree). A branch with no upstream
   * (the common case for a local dev instance) is reported as a clear no-op, not an error;
   * use {@link mergeBaseRef} to pick up changes that landed on the base branch.
   */
  async pull(worktreePath: string): Promise<{ updated: boolean; message: string }> {
    const upstream = await run('git', [
      '-C',
      worktreePath,
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{u}',
    ]);
    if (upstream.code !== 0) {
      return {
        updated: false,
        message:
          'This branch has no remote upstream — nothing to pull. Use "Merge from base" to pick up base-branch changes.',
      };
    }
    const before = await this.head(worktreePath);
    const r = await run('git', ['-C', worktreePath, 'pull', '--ff-only']);
    if (r.code !== 0) {
      throw new Error(
        `git pull failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ')}`
      );
    }
    const after = await this.head(worktreePath);
    return before === after
      ? { updated: false, message: 'Already up to date with upstream.' }
      : { updated: true, message: `Pulled ${before.slice(0, 7)} → ${after.slice(0, 7)}.` };
  }

  /**
   * Merge `baseRef` (the branch this instance was created from) into the worktree's current
   * branch — bringing forward commits that landed on the base (e.g. MJ wiring fixes). On a
   * merge conflict the merge is ABORTED so the worktree is never left half-merged; the caller
   * gets a clear error. After a successful merge the instance should re-run migrate + build.
   */
  async mergeBaseRef(
    worktreePath: string,
    baseRef: string
  ): Promise<{ updated: boolean; message: string }> {
    const ref = await this.resolveBaseRef(baseRef);
    const before = await this.head(worktreePath);
    const r = await run('git', ['-C', worktreePath, 'merge', '--no-edit', ref]);
    if (r.code !== 0) {
      // Never leave a conflicted/half-merged tree behind.
      await run('git', ['-C', worktreePath, 'merge', '--abort']);
      const detail = (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
      throw new Error(
        `Merge from ${ref} hit conflicts and was aborted — resolve them on the base branch, ` +
          `or make a fresh instance. ${detail}`.trim()
      );
    }
    const after = await this.head(worktreePath);
    return before === after
      ? { updated: false, message: `Already up to date with ${ref}.` }
      : {
          updated: true,
          message: `Merged ${ref} (${before.slice(0, 7)} → ${after.slice(0, 7)}). Re-run migrate + build to apply.`,
        };
  }

  /**
   * Create a worktree at `worktreePath` checking out `branch`. If `branch`
   * doesn't exist it is created off `baseRef`. Throws with actionable messages
   * on the common conflicts (path taken, branch already checked out).
   */
  async add(
    worktreePath: string,
    branch: string,
    baseRef: string,
    slug: string,
    sink: EventSink = noopSink
  ): Promise<void> {
    if (await this.pathInUse(worktreePath)) {
      throw new Error(`Worktree path already exists: ${worktreePath}`);
    }
    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    const exists = await this.branchExists(branch);
    const args = exists
      ? ['worktree', 'add', worktreePath, branch]
      : ['worktree', 'add', '-b', branch, worktreePath, await this.resolveBaseRef(baseRef)];

    emit(
      sink,
      slug,
      'worktree',
      'progress',
      `Creating worktree (${exists ? 'existing' : 'new'} branch ${branch})…`
    );
    try {
      await this.git(args, s => emit(sink, slug, 'worktree', 'info', s.trimEnd()));
    } catch (err) {
      const msg = (err as Error).message;
      if (/is already checked out|already used by worktree/i.test(msg)) {
        throw new Error(
          `Branch "${branch}" is already checked out in another worktree. Use a different branch.`
        );
      }
      throw err;
    }
    emit(sink, slug, 'worktree', 'success', `Worktree ready at ${worktreePath}`);
  }

  /** Remove the worktree directory (branch is preserved). */
  async remove(worktreePath: string, slug: string, sink: EventSink = noopSink): Promise<void> {
    if (!(await this.pathInUse(worktreePath))) return;
    emit(sink, slug, 'worktree', 'progress', `Removing worktree ${worktreePath}…`);
    const r = await run('git', [
      '-C',
      this.mjRepoPath,
      'worktree',
      'remove',
      '--force',
      worktreePath,
    ]);
    if (r.code !== 0) {
      // Last resort: prune the registration and delete the dir.
      await fs.rm(worktreePath, { recursive: true, force: true });
      await run('git', ['-C', this.mjRepoPath, 'worktree', 'prune']);
    }
    emit(sink, slug, 'worktree', 'success', 'Worktree removed');
  }

  /** Porcelain list of registered worktrees (path + branch). */
  async list(): Promise<Array<{ path: string; branch?: string }>> {
    const r = await run('git', ['-C', this.mjRepoPath, 'worktree', 'list', '--porcelain']);
    if (r.code !== 0) return [];
    const out: Array<{ path: string; branch?: string }> = [];
    let current: { path: string; branch?: string } | null = null;
    for (const line of r.stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) out.push(current);
        current = { path: line.slice('worktree '.length).trim() };
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice('branch '.length).replace('refs/heads/', '').trim();
      }
    }
    if (current) out.push(current);
    return out;
  }

  private async pathInUse(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  /** Verify the configured MJ repo path is a git repository. */
  async assertRepo(): Promise<void> {
    const r = await run('git', ['-C', this.mjRepoPath, 'rev-parse', '--is-inside-work-tree']);
    if (r.code !== 0) {
      throw new Error(
        `MJ repo not found or not a git repository: ${this.mjRepoPath}. Set MJDEV_MJ_REPO.`
      );
    }
  }
}
