import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run, runOrThrow } from './exec.js';
import { emit, type EventSink, noopSink } from './util.js';

/**
 * Owns the app-managed central MJ clone that every instance worktrees from.
 *
 * The tool no longer depends on the developer's personal MJ checkout: it seeds
 * its own clone once (fast/offline, from the local checkout — preserving the
 * dev's local branches as `origin/*` refs), then repoints `origin` at the
 * canonical GitHub remote so future fetches/PRs target GitHub, not the local
 * checkout it was seeded from.
 */
export class RepoManager {
  constructor(
    private readonly clonePath: string,
    private readonly sourcePath: string
  ) {}

  /** True when `dir` is the top of a git work tree. */
  private async isGitRepo(dir: string): Promise<boolean> {
    const r = await run('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree']);
    return r.code === 0;
  }

  /**
   * Ensure the central clone exists at `clonePath`. Idempotent: returns
   * immediately when it's already a git repo. Otherwise clones from the local
   * source checkout and repoints `origin` at the source's GitHub remote.
   */
  async ensureCentralClone(slug: string, sink: EventSink = noopSink): Promise<void> {
    if (await this.isGitRepo(this.clonePath)) return;

    if (!(await this.isGitRepo(this.sourcePath))) {
      throw new Error(
        `Cannot seed the MJ clone: source checkout not found or not a git repo: ${this.sourcePath}. ` +
          `Set MJDEV_MJ_SOURCE to an existing MJ checkout to seed from, or MJDEV_MJ_REPO to worktree directly from one.`
      );
    }

    await fs.mkdir(path.dirname(this.clonePath), { recursive: true });
    emit(sink, slug, 'clone', 'progress', `Seeding MJ clone from ${this.sourcePath}…`);
    await runOrThrow('git', ['clone', this.sourcePath, this.clonePath], {
      onOutput: s => emit(sink, slug, 'clone', 'info', s.trimEnd()),
    });

    // Repoint origin at the canonical remote so fetches/PRs target GitHub.
    const origin = await run('git', ['-C', this.sourcePath, 'remote', 'get-url', 'origin']);
    const url = origin.stdout.trim();
    if (origin.code === 0 && url) {
      await run('git', ['-C', this.clonePath, 'remote', 'set-url', 'origin', url]);
      emit(sink, slug, 'clone', 'info', `origin → ${url}`);
    }
    emit(sink, slug, 'clone', 'success', `MJ clone ready at ${this.clonePath}`);
  }
}
