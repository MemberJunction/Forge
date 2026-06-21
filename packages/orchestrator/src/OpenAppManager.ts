import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run, runOrThrow } from './exec.js';
import { emit, type EventSink, noopSink } from './util.js';
import type { ResolvedPaths } from './paths.js';
import { AppRepoManager } from './AppRepoManager.js';
import { WorktreeManager } from './WorktreeManager.js';
import { AppDevStateStore } from './AppDevStateStore.js';

/** Workspaces glob (relative to the MJ worktree root) that hosts dev-linked apps. */
export const DEV_APPS_GLOB = 'packages/dev-apps/*';
/** Exclude pattern that hides the nested app worktrees from the MJ worktree's git. */
export const DEV_APPS_EXCLUDE = 'packages/dev-apps/';

export interface SingleCopyResult {
  ok: boolean;
  /** Resolved realpath of `@memberjunction/core` as seen from MJAPI. */
  fromApi: string;
  /** Resolved realpath as seen from the dev-linked app member. */
  fromMember: string;
  /** A nested second copy under the member, if any (a dedup failure). */
  nestedCopy?: string;
  detail: string;
}

export interface LinkResolutionResult {
  appName: string;
  clonePath: string;
  /** The per-instance app worktree, nested at the workspace member path. */
  memberPath: string;
  appBranch: string;
  materialization: 'nested-worktree';
  singleCopy: SingleCopyResult;
}

export interface LinkResolutionOptions {
  /** Branch to develop the app on in this instance (default `mjdev/<slug>/<app>`). */
  appBranch?: string;
  /** Start point for a new app branch (default the clone's `HEAD`). */
  baseRef?: string;
  /** Child-process env (Node version) for `npm install`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Phase-B open-app dev-linking. This first cut implements the Slice-0 **resolution
 * spine** (no MJ Open App Engine yet): clone the app once (shared object store),
 * cut a per-instance app worktree DIRECTLY at the npm workspace member path
 * (`packages/dev-apps/<app>`, "Option Y" — proven to dedupe `@memberjunction/*`),
 * add the workspaces glob, hide the gitlink, `npm install`, and assert single-copy.
 * The engine steps (manifest/schema/migrations/packages/config/bootstrap/record)
 * layer on top in later slices via the worktree's own engine.
 */
export class OpenAppManager {
  private readonly appRepos: AppRepoManager;
  private readonly state: AppDevStateStore;

  constructor(private readonly paths: ResolvedPaths) {
    this.appRepos = new AppRepoManager(this.paths.appsReposDir);
    this.state = new AppDevStateStore(this.paths);
  }

  /** The workspace member path (and nested app-worktree location) for an app. */
  memberPathFor(mjWorktreePath: string, appName: string): string {
    return path.join(mjWorktreePath, 'packages', 'dev-apps', appName);
  }

  /**
   * Slice-0 dev-link: make `appRef`'s source resolvable inside the instance's MJ
   * worktree as a single-copy workspace member, on its own per-instance branch.
   * Does NOT yet run the install engine (schema/migrations/registration).
   */
  async linkResolution(
    slug: string,
    mjWorktreePath: string,
    appRef: string,
    opts: LinkResolutionOptions = {},
    sink: EventSink = noopSink
  ): Promise<LinkResolutionResult> {
    const appName = AppRepoManager.appDirName(appRef);
    const memberPath = this.memberPathFor(mjWorktreePath, appName);
    const appBranch = opts.appBranch?.trim() || `mjdev/${slug}/${appName}`;
    const baseRef = opts.baseRef?.trim() || 'HEAD';

    // 1) Shared clone (object store), then per-instance worktree at the member path.
    const clonePath = await this.appRepos.ensureAppClone(appRef, {}, sink);
    await this.addWorkspaceGlob(mjWorktreePath, DEV_APPS_GLOB);
    await this.appRepos.addWorktreeExclude(mjWorktreePath, DEV_APPS_EXCLUDE);
    emit(sink, slug, 'app-link', 'progress', `Cutting app worktree ${appName}@${appBranch}…`);
    await new WorktreeManager(clonePath).add(memberPath, appBranch, baseRef, slug, sink);

    // 2) Install so npm hoists @memberjunction/* to the one host copy, then verify.
    emit(sink, slug, 'app-link', 'progress', 'Installing workspace dependencies…');
    await this.npmInstall(mjWorktreePath, opts.env, sink);
    const singleCopy = await this.assertSingleCopy(mjWorktreePath, memberPath);
    emit(
      sink,
      slug,
      'app-link',
      singleCopy.ok ? 'success' : 'error',
      `Single-copy check: ${singleCopy.detail}`
    );

    // 3) Record dev-link state (Forge-side overlay).
    await this.state.upsert({
      slug,
      appName,
      appRef,
      mode: 'dev',
      localDevPath: clonePath,
      materialization: 'nested-worktree',
      ignoreVersionRangeUsed: false,
      linkedBranch: appBranch,
      createdAt: new Date().toISOString(),
    });

    return {
      appName,
      clonePath,
      memberPath,
      appBranch,
      materialization: 'nested-worktree',
      singleCopy,
    };
  }

  /** Add a workspaces glob to the MJ worktree's root package.json (idempotent). */
  async addWorkspaceGlob(mjWorktreePath: string, glob: string): Promise<void> {
    const file = path.join(mjWorktreePath, 'package.json');
    const pkg = JSON.parse(await fs.readFile(file, 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const list = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
    if (list.includes(glob)) return;
    list.push(glob);
    if (Array.isArray(pkg.workspaces) || pkg.workspaces === undefined) pkg.workspaces = list;
    else pkg.workspaces.packages = list;
    await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  /** Remove a previously-added workspaces glob (for reversal). */
  async removeWorkspaceGlob(mjWorktreePath: string, glob: string): Promise<void> {
    const file = path.join(mjWorktreePath, 'package.json');
    const pkg = JSON.parse(await fs.readFile(file, 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const list = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (!list) return;
    const next = list.filter(g => g !== glob);
    if (next.length === list.length) return;
    if (Array.isArray(pkg.workspaces)) pkg.workspaces = next;
    else if (pkg.workspaces?.packages) pkg.workspaces.packages = next;
    await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  /** Run `npm install` in the MJ worktree (hoists/dedupes workspace members). */
  async npmInstall(
    mjWorktreePath: string,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<void> {
    await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: mjWorktreePath,
      env,
      onOutput: s => emit(sink, '', 'app-link', 'info', s.trimEnd()),
    });
  }

  /**
   * Assert exactly one resolved `@memberjunction/core` shared between MJAPI and the
   * dev-linked app member, and no nested second copy under the member — the hard
   * single-copy invariant (kills the duplicate-`BaseSingleton` hazard).
   */
  async assertSingleCopy(mjWorktreePath: string, memberPath: string): Promise<SingleCopyResult> {
    const apiDir = path.join(mjWorktreePath, 'packages', 'MJAPI');
    const fromApi = await this.resolveCoreFrom(apiDir);
    const fromMember = await this.resolveCoreFrom(memberPath);
    const nested = await this.firstNestedMjCopy(memberPath);
    const ok = !!fromApi && fromApi === fromMember && !nested;
    const detail = !fromApi
      ? `could not resolve @memberjunction/core from MJAPI (${apiDir})`
      : !fromMember
        ? 'could not resolve @memberjunction/core from the app member'
        : nested
          ? `nested second copy under member: ${nested}`
          : fromApi !== fromMember
            ? `two copies (api=${fromApi}, member=${fromMember})`
            : `one copy at ${fromApi}`;
    return { ok, fromApi, fromMember, nestedCopy: nested, detail };
  }

  /** realpath of `@memberjunction/core/package.json` resolved from `cwd`, or '' on failure. */
  private async resolveCoreFrom(cwd: string): Promise<string> {
    const r = await run(
      'node',
      [
        '-e',
        "process.stdout.write(require('fs').realpathSync(require.resolve('@memberjunction/core/package.json')))",
      ],
      { cwd }
    );
    return r.code === 0 ? r.stdout.trim() : '';
  }

  /** Path of a nested `node_modules/@memberjunction` under the member, if present. */
  private async firstNestedMjCopy(memberPath: string): Promise<string | undefined> {
    const nested = path.join(memberPath, 'node_modules', '@memberjunction');
    try {
      await fs.access(nested);
      return nested;
    } catch {
      return undefined;
    }
  }
}
