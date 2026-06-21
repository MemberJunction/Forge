import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run, runOrThrow } from './exec.js';
import { emit, type EventSink, noopSink } from './util.js';

export interface EnsureAppCloneOptions {
  /** Branch to check out in the clone (falls back to `origin/<branch>`). */
  branch?: string;
}

/**
 * Owns the SHARED clone (object store) of an open-app source repo under
 * `~/MJDev/repos/apps/<app>`. Each instance gets its OWN git worktree of the app
 * (on its own branch), cut by a `WorktreeManager` pointed at this clone — the same
 * way MJ instances are cut from `repos/mj`. That per-instance worktree is placed
 * DIRECTLY at the npm-workspace member path inside the MJ worktree
 * (`mj/packages/dev-apps/<app>`, "Option Y"): a Slice-0 probe proved a real nested
 * directory dedupes `@memberjunction/*` to the single host copy, whereas a symlink
 * to an external worktree does NOT (Node resolves the symlink's external realpath
 * and misses the host node_modules). The nested worktree's `.git` gitlink is then
 * hidden from the MJ worktree via {@link addWorktreeExclude}.
 *
 * This shared-clone + per-instance-worktree model is what enables parallel feature
 * development of one open app across several instances (different branches) and
 * local merge-back — the swarm workflow. Mirrors {@link RepoManager}:
 * seed-from-local-checkout-or-clone-from-URL, repoint origin at GitHub.
 */
export class AppRepoManager {
  constructor(private readonly appsReposDir: string) {}

  /** Derive a filesystem-safe app directory name from a GitHub URL or local path. */
  static appDirName(appRef: string): string {
    const trimmed = appRef.trim().replace(/[/\\]+$/, '');
    const base = trimmed.split(/[/\\:]/).pop() ?? trimmed;
    return base.replace(/\.git$/i, '') || 'app';
  }

  /** Absolute path to an app's canonical editable clone. */
  clonePathFor(appRef: string): string {
    return path.join(this.appsReposDir, AppRepoManager.appDirName(appRef));
  }

  /** True when `dir` is the top of a git work tree. */
  private async isGitRepo(dir: string): Promise<boolean> {
    const r = await run('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree']);
    return r.code === 0;
  }

  /**
   * Ensure the canonical editable clone for `appRef` exists. `appRef` may be a
   * local checkout (seed-clone, then repoint `origin` at its remote) or a remote
   * URL (clone directly). Idempotent; checks out `branch` when given. Returns the
   * clone path.
   */
  async ensureAppClone(
    appRef: string,
    opts: EnsureAppCloneOptions = {},
    sink: EventSink = noopSink
  ): Promise<string> {
    const clonePath = this.clonePathFor(appRef);
    const name = AppRepoManager.appDirName(appRef);

    if (!(await this.isGitRepo(clonePath))) {
      const fromLocal = await this.isGitRepo(appRef);
      await fs.mkdir(path.dirname(clonePath), { recursive: true });
      emit(sink, name, 'app-clone', 'progress', `Cloning open app from ${appRef}…`);
      await runOrThrow('git', ['clone', appRef, clonePath], {
        onOutput: s => emit(sink, name, 'app-clone', 'info', s.trimEnd()),
      });
      // When seeded from a local checkout, repoint origin at the canonical remote.
      if (fromLocal) {
        const origin = await run('git', ['-C', appRef, 'remote', 'get-url', 'origin']);
        const url = origin.stdout.trim();
        if (origin.code === 0 && url) {
          await run('git', ['-C', clonePath, 'remote', 'set-url', 'origin', url]);
        }
      }
    }

    if (opts.branch) {
      const co = await run('git', ['-C', clonePath, 'checkout', opts.branch]);
      if (co.code !== 0) {
        await run('git', ['-C', clonePath, 'checkout', '-B', opts.branch, `origin/${opts.branch}`]);
      }
    }

    emit(sink, name, 'app-clone', 'success', `Open app ready at ${clonePath}`);
    return clonePath;
  }

  /**
   * Add `pattern` to the git **common** dir's `info/exclude` so a nested app
   * worktree never appears as tracked churn — without editing the tracked
   * `.gitignore` (which would be an MJ-repo change). Must be the COMMON dir, not
   * the per-worktree gitdir: git reads `info/exclude` from `--git-common-dir` for
   * linked worktrees, so a per-worktree write is silently ignored. The common dir
   * here is the app-managed clone's `.git` (shared across instances — the exclude
   * applies to every instance worktree, which is exactly what we want). Idempotent.
   */
  async addWorktreeExclude(worktreePath: string, pattern: string): Promise<void> {
    const gd = await run('git', ['-C', worktreePath, 'rev-parse', '--git-common-dir']);
    if (gd.code !== 0) return;
    let gitDir = gd.stdout.trim();
    if (!path.isAbsolute(gitDir)) gitDir = path.resolve(worktreePath, gitDir);
    const infoDir = path.join(gitDir, 'info');
    const excludeFile = path.join(infoDir, 'exclude');
    await fs.mkdir(infoDir, { recursive: true });

    let current = '';
    try {
      current = await fs.readFile(excludeFile, 'utf8');
    } catch {
      /* no exclude file yet */
    }
    if (current.split('\n').some(l => l.trim() === pattern.trim())) return;
    const prefix = current.length && !current.endsWith('\n') ? `${current}\n` : current;
    await fs.writeFile(excludeFile, `${prefix}${pattern}\n`);
  }
}
