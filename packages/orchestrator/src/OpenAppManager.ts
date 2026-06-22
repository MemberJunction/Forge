import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run, runOrThrow } from './exec.js';
import { emit, type EventSink, noopSink } from './util.js';
import type { ResolvedPaths } from './paths.js';
import { AppRepoManager } from './AppRepoManager.js';
import { WorktreeManager } from './WorktreeManager.js';
import { AppDevStateStore } from './AppDevStateStore.js';
import {
  WorktreeEngineRunner,
  ENGINE_SCRATCH_EXCLUDE,
  type EngineDbConfig,
  type EngineRunResult,
} from './WorktreeEngineRunner.js';
import { addEntityPackageMapping, removeEntityPackageMapping } from './entityPackageMapping.js';

/** The minimal manifest shape the manager reads from a member's `mj-app.json`. */
interface AppManifestLite {
  name: string;
  version: string;
  schema?: { name?: string; entityPackage?: string };
  packages?: {
    registry?: string;
    server?: Array<{ name: string; role?: string; startupExport?: string }>;
    client?: Array<{ name: string; role?: string }>;
    shared?: Array<{ name: string; role?: string }>;
  };
  /** Other open apps this app depends on, keyed by app name. */
  dependencies?: Record<string, string | { version: string; repository?: string }>;
}

/** One of an app's direct open-app dependencies, with whether it's already in the instance. */
export interface AppDependency {
  /** Dependency app name (the manifest key). */
  name: string;
  /** Declared semver range. */
  versionRange: string;
  /** GitHub repo URL from the manifest, if declared (the source for install/dev-link). */
  repository?: string;
  /** True when an Active `MJ: Open Apps` row already exists for it in the instance. */
  present: boolean;
}

/** Normalized, oracle-diffable snapshot of an app's install footprint in a worktree. */
export interface ParitySnapshot {
  appName: string;
  schema?: string;
  /** `dynamicPackages.server` entries for the app (raw matched lines, trimmed). */
  dynamicServerLines: string[];
  /** `entityPackageName` entries (`schema: pkg`) as `key=value`, sorted. */
  entityPackageEntries: string[];
  /** Declared app deps as they appear in MJAPI/package.json (name@spec, in key order). */
  serverDeps: string[];
  /** Declared app deps as they appear in MJExplorer/package.json (name@spec, in key order). */
  clientDeps: string[];
  /** angular.json prebundle.exclude patterns (sorted). */
  prebundleExcludes: string[];
  /** Non-comment import specifiers from the generated client bootstrap (in order). */
  clientBootstrapImports: string[];
}

/**
 * Workspaces glob (relative to the MJ worktree root) that makes a dev-linked app's
 * publishable SUB-packages npm workspace members. Reaches one level deeper than
 * `packages/dev-apps/*` because each open app is its OWN workspace
 * (`workspaces: ["packages/*"]`), so its publishable packages live at
 * `packages/dev-apps/<app>/packages/*`. A probe proved the shallow glob fails —
 * it matches the app root (whose package.json is its own workspace), leaving the
 * sub-packages unresolved so npm hits the registry (E404) and MJAPI can't resolve
 * the app's published name to local source. The deep glob makes the sub-package a
 * member → MJAPI resolves the app BY NAME to the local dev source (parity) and
 * `@memberjunction/*` dedupes to one copy.
 */
export const DEV_APPS_GLOB = 'packages/dev-apps/*/packages/*';
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
  private readonly runnerFor: (worktreePath: string) => WorktreeEngineRunner;

  /**
   * @param paths resolved on-disk locations.
   * @param runnerFactory builds the worktree engine runner for a worktree; defaults to
   *   the real {@link WorktreeEngineRunner}. Injectable so tests can drive the engine
   *   steps with a DB-free fake entrypoint (same seam the runner's own tests use).
   */
  constructor(
    private readonly paths: ResolvedPaths,
    runnerFactory: (worktreePath: string) => WorktreeEngineRunner = p => new WorktreeEngineRunner(p)
  ) {
    this.appRepos = new AppRepoManager(this.paths.appsReposDir);
    this.state = new AppDevStateStore(this.paths);
    this.runnerFor = runnerFactory;
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

    // 3) Record dev-link state (Forge-side overlay) + remember the ref for re-adding.
    // Capture the MANIFEST name now (from the clone) so removal works later even after
    // the member worktree is gone (e.g. after a switch to installed mode).
    const manifestName = (await this.readManifest(clonePath).catch(() => undefined))?.name;
    await this.state.addRecent(appRef);
    await this.state.upsert({
      slug,
      appName,
      manifestName,
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

  /**
   * Top-level dev-link: the full ordered flow a real `mj app install` runs, with the
   * dev-only seams (local source resolution + optional version override). Chains the
   * resolution layer → version gate → schema+migrations → full mutation set, then
   * returns the parity snapshot. This is the single entry point the façade/CLI/IPC call.
   */
  async linkApp(
    slug: string,
    mjWorktreePath: string,
    appRef: string,
    dbConfig: EngineDbConfig,
    opts: {
      ignoreVersionRange?: boolean;
      allowDoubleUnderscore?: boolean;
      appBranch?: string;
      baseRef?: string;
      env?: NodeJS.ProcessEnv;
    } = {},
    sink: EventSink = noopSink
  ): Promise<{ appName: string; singleCopy: SingleCopyResult; snapshot: ParitySnapshot }> {
    const env = opts.env ?? process.env;
    const link = await this.linkResolution(
      slug,
      mjWorktreePath,
      appRef,
      { appBranch: opts.appBranch, baseRef: opts.baseRef, env },
      sink
    );
    await this.checkVersionCompat(
      slug,
      mjWorktreePath,
      link.appName,
      dbConfig,
      opts.ignoreVersionRange ?? false,
      env,
      sink
    );
    if (opts.ignoreVersionRange) {
      const st = await this.state.get(slug, link.appName);
      if (st) await this.state.upsert({ ...st, ignoreVersionRangeUsed: true });
    }
    await this.ensureSchemaAndMigrate(
      slug,
      mjWorktreePath,
      link.appName,
      dbConfig,
      env,
      sink,
      opts.allowDoubleUnderscore === true
    );
    await this.applyFullMutationSet(slug, mjWorktreePath, link.appName, dbConfig, env, sink);
    const snapshot = await this.captureParitySnapshot(mjWorktreePath, link.appName);
    emit(sink, slug, 'app-link', 'success', `Dev-linked ${link.appName}`);
    return { appName: link.appName, singleCopy: link.singleCopy, snapshot };
  }

  /**
   * Plain install (NOT dev-link): drive the worktree's OWN engine `InstallApp` — the
   * real `mj app install` path. The engine fetches the app AND its full transitive
   * open-app dependency graph from GitHub (leaf-first), runs migrations, mutates
   * config/angular/package deps, installs npm packages, and records every
   * `MJ: Open Apps` row Active. Maximal parity by construction (no dev seams). Records
   * a Forge-side overlay (mode `installed`) so the app shows in {@link listApps} and
   * the recents list. Returns the installed top-level app name + version.
   *
   * Note: any transitive dependency apps the engine auto-installs get their own
   * `MJ: Open Apps` rows but are not added to the Forge overlay here (they are an
   * install detail); a future `listApps` merge with `ListInstalledApps` would surface them.
   */
  async installApp(
    slug: string,
    mjWorktreePath: string,
    source: string,
    dbConfig: EngineDbConfig,
    opts: {
      version?: string;
      githubToken?: string;
      allowDoubleUnderscore?: boolean;
      env?: NodeJS.ProcessEnv;
    } = {},
    sink: EventSink = noopSink
  ): Promise<{ appName: string; version: string }> {
    const env = opts.env ?? process.env;
    await this.appRepos.addWorktreeExclude(mjWorktreePath, ENGINE_SCRATCH_EXCLUDE);
    const runner = this.runnerFor(mjWorktreePath);
    emit(sink, slug, 'app-install', 'progress', `Installing ${source}…`);
    const result = await runner.run(
      slug,
      {
        steps: ['install'],
        source,
        version: opts.version,
        githubToken: opts.githubToken,
        // First-party MJ apps (e.g. bizapps-*) declare reserved `__mj_*` schemas;
        // installing them requires opting past the double-underscore guard.
        allowDoubleUnderscore: opts.allowDoubleUnderscore === true,
        dbConfig,
        mjCoreSchema: '__mj',
      },
      env,
      sink
    );
    if (!result.ok) throw new Error(`Install failed: ${result.error ?? 'unknown'}`);
    const r = (result.results?.install ?? {}) as { appName?: string; version?: string };
    const appName = r.appName ?? AppRepoManager.appDirName(source);
    await this.state.addRecent(source);
    await this.state.upsert({
      slug,
      appName,
      // For installs the result AppName IS the manifest name — same as the overlay key.
      manifestName: appName,
      appRef: source,
      mode: 'installed',
      localDevPath: '',
      materialization: 'published',
      ignoreVersionRangeUsed: false,
      createdAt: new Date().toISOString(),
    });
    emit(
      sink,
      slug,
      'app-install',
      'success',
      `Installed ${appName}${r.version ? ` v${r.version}` : ''}`
    );
    return { appName, version: r.version ?? '' };
  }

  /**
   * Resolve an app's DIRECT open-app dependencies for the dev-link pre-flight popup.
   * Clones the app (idempotent) to read its manifest `dependencies`, then asks the
   * instance's engine which apps are already Active, so the UI can prompt only for the
   * MISSING ones (install vs dev-link per dep). Pure detection — installs nothing.
   * Dev-link doesn't auto-resolve deps (unlike the engine's `InstallApp`), so this is
   * how a dev-linked app's prerequisites get satisfied.
   */
  async resolveDevLinkDependencies(
    slug: string,
    mjWorktreePath: string,
    appRef: string,
    dbConfig: EngineDbConfig,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<{ appName: string; dependencies: AppDependency[] }> {
    const clonePath = await this.appRepos.ensureAppClone(appRef, {}, sink);
    const manifest = await this.readManifest(clonePath).catch(() => undefined);
    const appName = manifest?.name ?? AppRepoManager.appDirName(appRef);
    const depsObj = manifest?.dependencies ?? {};
    const names = Object.keys(depsObj);
    if (names.length === 0) return { appName, dependencies: [] };

    // Best-effort: which deps are already Active in the instance (MJ-side)? listApps
    // needs no manifest/member, so run the engine without one (the app isn't linked yet).
    const present = new Set<string>();
    try {
      await this.appRepos.addWorktreeExclude(mjWorktreePath, ENGINE_SCRATCH_EXCLUDE);
      const r = await this.runnerFor(mjWorktreePath).run(
        slug,
        { steps: ['listApps'], dbConfig, mjCoreSchema: '__mj' },
        env,
        sink
      );
      const apps =
        (r.results?.listApps as { apps?: Array<{ Name: string; Status: string }> })?.apps ?? [];
      for (const a of apps) if (a.Status === 'Active') present.add(a.Name);
    } catch {
      // Instance not migrated yet / DB unreachable — treat every dep as missing.
    }

    const dependencies: AppDependency[] = names.map(name => {
      const v = depsObj[name];
      return {
        name,
        versionRange: typeof v === 'string' ? v : v.version,
        repository: typeof v === 'string' ? undefined : v.repository,
        present: present.has(name),
      };
    });
    return { appName, dependencies };
  }

  /**
   * Uninstall an INSTALLED app (the inverse of {@link installApp}) via the worktree's
   * own exported `RemoveApp`: reverse the package/config mutations, set the
   * `MJ: Open Apps` row Removed, and DROP the schema unless `keepData`. Identified by
   * manifest name. Then reconcile `node_modules` and drop the Forge overlay.
   * (Dev-linked apps are torn down by {@link unlinkApp} instead.) `allowDoubleUnderscore`
   * defaults true so first-party `__mj_*` app schemas can be dropped.
   */
  async removeInstalledApp(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    opts: {
      keepData?: boolean;
      force?: boolean;
      allowDoubleUnderscore?: boolean;
      env?: NodeJS.ProcessEnv;
    } = {},
    sink: EventSink = noopSink
  ): Promise<void> {
    const env = opts.env ?? process.env;
    await this.appRepos.addWorktreeExclude(mjWorktreePath, ENGINE_SCRATCH_EXCLUDE);
    // The engine's RemoveApp keys on the MANIFEST name, which can differ from the
    // overlay key (a dev-link stores the dir name). Resolve it: prefer the captured
    // manifestName, else read the clone/member manifest, else fall back to appName.
    const state = await this.state.get(slug, appName);
    let manifestName = state?.manifestName;
    if (!manifestName) {
      const dir = state?.localDevPath || this.memberPathFor(mjWorktreePath, appName);
      manifestName = (await this.readManifest(dir).catch(() => undefined))?.name ?? appName;
    }
    const runner = this.runnerFor(mjWorktreePath);
    emit(sink, slug, 'app-remove', 'progress', `Removing installed app ${appName}…`);
    const result = await runner.run(
      slug,
      {
        steps: ['removeApp'],
        appName: manifestName,
        keepData: opts.keepData,
        force: opts.force,
        allowDoubleUnderscore: opts.allowDoubleUnderscore !== false,
        dbConfig,
        mjCoreSchema: '__mj',
      },
      env,
      sink
    );
    if (!result.ok) throw new Error(`Remove failed: ${result.error ?? 'unknown'}`);
    // RemoveApp edits MJAPI/MJExplorer package.json — reconcile node_modules.
    emit(sink, slug, 'app-remove', 'progress', 'Reinstalling workspace dependencies…');
    await this.npmInstall(mjWorktreePath, env, sink);
    await this.state.remove(slug, appName);
    emit(sink, slug, 'app-remove', 'success', `Removed ${appName}`);
  }

  /** Recently-used app refs (for the add-app dropdown), newest first. */
  async recentApps(): Promise<string[]> {
    return this.state.listRecents();
  }

  /** Linked-app overlay state for an instance (Forge-side dev state). */
  async listApps(slug: string): Promise<
    Array<{
      appName: string;
      mode: string;
      appRef: string;
      ignoreVersionRangeUsed: boolean;
      linkedBranch?: string;
    }>
  > {
    const apps = await this.state.list(slug);
    return apps.map(a => ({
      appName: a.appName,
      mode: a.mode,
      appRef: a.appRef,
      ignoreVersionRangeUsed: a.ignoreVersionRangeUsed,
      linkedBranch: a.linkedBranch,
    }));
  }

  /**
   * Slice-1 DB spine: drive the worktree's OWN engine to create the app schema
   * and run its local migrations against the instance DB (`SchemaExists` →
   * `CreateAppSchema` → `RunAppMigrations(MigrationsDir=local)`), then read back
   * the per-app `flyway_schema_history` to prove tracking lives in the APP schema
   * (not `__mj`). Granular handlers only — no `InstallApp`, no version check — so
   * this is identical to the install path's schema/migration steps. Returns the
   * raw engine result (per-step data under `results`).
   */
  async ensureSchemaAndMigrate(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink,
    allowDoubleUnderscore = false
  ): Promise<EngineRunResult> {
    const memberPath = this.memberPathFor(mjWorktreePath, appName);
    // Keep the engine scratch dir out of the worktree's git status.
    await this.appRepos.addWorktreeExclude(mjWorktreePath, ENGINE_SCRATCH_EXCLUDE);
    const runner = this.runnerFor(mjWorktreePath);
    emit(sink, slug, 'app-link', 'progress', `Provisioning ${appName} schema + migrations…`);
    const result = await runner.run(
      slug,
      {
        steps: ['ensureSchema', 'migrate', 'schemaInfo'],
        memberPath,
        manifestPath: path.join(memberPath, 'mj-app.json'),
        dbConfig,
        mjCoreSchema: '__mj',
        // First-party MJ apps declare reserved `__mj_*` schemas; opt past the guard.
        allowDoubleUnderscore,
      },
      env,
      sink
    );
    if (!result.ok) {
      throw new Error(`App schema/migration step failed: ${result.error ?? 'unknown'}`);
    }
    return result;
  }

  /**
   * Slice-2 full mutation set: reproduce the install orchestrator's ordered shell
   * for everything after schema/migrations — record the `MJ: Open Apps` row,
   * `AddAppPackages` + `RunPackageInstall`, `AddServerDynamicPackages`, the
   * reproduced `entityPackageName` mapping, `AddPrebundleExcludes`, flip status to
   * Active, and `RegenerateClientBootstrap`. Every step but `entityPackageName`
   * runs through the worktree's OWN engine (parity); `entityPackageName` is the one
   * non-exported handler, reproduced Forge-side on `mj.config.cjs`. Returns the
   * engine result (per-step data) for the caller to assert against.
   */
  async applyFullMutationSet(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<EngineRunResult> {
    const memberPath = this.memberPathFor(mjWorktreePath, appName);
    await this.appRepos.addWorktreeExclude(mjWorktreePath, ENGINE_SCRATCH_EXCLUDE);
    const runner = this.runnerFor(mjWorktreePath);
    emit(sink, slug, 'app-link', 'progress', `Applying install mutation set for ${appName}…`);
    const result = await runner.run(
      slug,
      {
        steps: [
          'record',
          'addPackages',
          'serverConfig',
          'angularExcludes',
          'setActive',
          'clientBootstrap',
          'listApps',
        ],
        memberPath,
        manifestPath: path.join(memberPath, 'mj-app.json'),
        dbConfig,
        mjCoreSchema: '__mj',
      },
      env,
      sink
    );
    if (!result.ok) {
      throw new Error(`Install mutation set failed: ${result.error ?? 'unknown'}`);
    }

    // The one non-exported step: entityPackageName mapping (parity reproduction).
    const manifest = await this.readManifest(memberPath);
    const ep = await addEntityPackageMapping(mjWorktreePath, manifest);
    if (!ep.success) throw new Error(`entityPackageName mapping failed: ${ep.error}`);
    emit(
      sink,
      slug,
      'app-link',
      ep.changed ? 'success' : 'info',
      ep.changed
        ? 'Added entityPackageName mapping'
        : 'entityPackageName: no entities package (no-op)'
    );
    return result;
  }

  /**
   * Slice-3 reversal: undo a dev-link in the engine's RemoveApp order, then reverse
   * the resolution layer. Config/DB removal runs through the worktree engine
   * (RemoveServerDynamicPackages, RemoveAppPackages, RemovePrebundleExcludes,
   * SetAppStatus Removed, RegenerateClientBootstrap, optional DropAppSchema) while
   * the member is still present (its manifest is needed); then Forge removes the
   * entityPackageName mapping, the member worktree, the workspaces glob (if last),
   * runs a final `npm install`, and drops the dev-state. `dropSchema` defaults off
   * so data survives a relink (Skyway resumes).
   */
  async unlinkApp(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    opts: { dropSchema?: boolean; env?: NodeJS.ProcessEnv } = {},
    sink: EventSink = noopSink
  ): Promise<void> {
    const env = opts.env ?? process.env;
    const memberPath = this.memberPathFor(mjWorktreePath, appName);
    const manifest = await this.readManifest(memberPath).catch(() => undefined);
    const state = await this.state.get(slug, appName);

    const steps = [
      'removeServerConfig',
      'removePackages',
      'removeAngularExcludes',
      'setRemoved',
      'clientBootstrap',
    ];
    // Full teardown also clears the app's __mj entity metadata before dropping the
    // schema (mirrors the engine's remove flow); keep-data unlink leaves both so a
    // relink resumes cleanly.
    if (opts.dropSchema) steps.push('cleanMetadata', 'dropSchema');
    const runner = this.runnerFor(mjWorktreePath);
    emit(sink, slug, 'app-unlink', 'progress', `Reversing dev-link for ${appName}…`);
    const result = await runner.run(
      slug,
      {
        steps,
        memberPath,
        manifestPath: path.join(memberPath, 'mj-app.json'),
        dbConfig,
        mjCoreSchema: '__mj',
      },
      env,
      sink
    );
    if (!result.ok)
      throw new Error(`Unlink mutation reversal failed: ${result.error ?? 'unknown'}`);

    if (manifest?.schema?.name) {
      await removeEntityPackageMapping(mjWorktreePath, manifest.schema.name);
    }

    // Reverse the resolution layer: remove the member worktree, then the glob if no
    // other dev-app members remain, then a final install to clean node_modules.
    const clonePath = state?.localDevPath ?? this.appRepos.clonePathFor(state?.appRef ?? appName);
    await new WorktreeManager(clonePath).remove(memberPath, slug, sink).catch(() => {});
    await fs.rm(memberPath, { recursive: true, force: true }).catch(() => {});
    if (await this.noDevAppMembersRemain(mjWorktreePath)) {
      await this.removeWorkspaceGlob(mjWorktreePath, DEV_APPS_GLOB);
    }
    emit(sink, slug, 'app-unlink', 'progress', 'Reinstalling workspace dependencies…');
    await this.npmInstall(mjWorktreePath, env, sink);
    await this.state.remove(slug, appName);
    emit(sink, slug, 'app-unlink', 'success', `Unlinked ${appName}`);
  }

  /**
   * Slice-3 mode toggle — a PURE resolution switch that NEVER re-derives package
   * deps (Add/RemoveAppPackages would reorder keys → drift; the install footprint in
   * package.json stays byte-stable). `dev`→`installed` removes the member worktree +
   * glob so the app resolves from its published release; `installed`→`dev`
   * re-materializes the member off the shared clone. Either way it re-installs and
   * records the new mode.
   */
  async switchMode(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    target: 'dev' | 'installed',
    opts: { env?: NodeJS.ProcessEnv; baseRef?: string } = {},
    sink: EventSink = noopSink
  ): Promise<void> {
    const env = opts.env ?? process.env;
    const state = await this.state.get(slug, appName);
    if (!state) throw new Error(`No dev-link state for ${appName} in ${slug}`);
    if (state.mode === target) {
      emit(sink, slug, 'app-switch', 'info', `Already in ${target} mode`);
      return;
    }
    const memberPath = this.memberPathFor(mjWorktreePath, appName);

    if (target === 'installed') {
      await new WorktreeManager(state.localDevPath).remove(memberPath, slug, sink).catch(() => {});
      await fs.rm(memberPath, { recursive: true, force: true }).catch(() => {});
      if (await this.noDevAppMembersRemain(mjWorktreePath)) {
        await this.removeWorkspaceGlob(mjWorktreePath, DEV_APPS_GLOB);
      }
    } else {
      await this.addWorkspaceGlob(mjWorktreePath, DEV_APPS_GLOB);
      await this.appRepos.addWorktreeExclude(mjWorktreePath, DEV_APPS_EXCLUDE);
      const branch = state.linkedBranch ?? `mjdev/${slug}/${appName}`;
      await new WorktreeManager(state.localDevPath).add(
        memberPath,
        branch,
        opts.baseRef ?? 'HEAD',
        slug,
        sink
      );
    }
    emit(sink, slug, 'app-switch', 'progress', `Reinstalling for ${target} mode…`);
    await this.npmInstall(mjWorktreePath, env, sink);
    await this.state.upsert({ ...state, mode: target });
    emit(sink, slug, 'app-switch', 'success', `Switched ${appName} to ${target} mode`);
  }

  /**
   * Slice-4 version gate (parity): a real install fails on an incompatible MJ
   * version range; dev-link does the same unless `ignoreVersionRange` is set (then it
   * warns and proceeds — the sanctioned off-tag dev case). Returns the engine verdict.
   */
  async checkVersionCompat(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    ignoreVersionRange = false,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<{ compatible: boolean; overridden?: boolean; range?: string; mjVersion?: string }> {
    const r = await this.runSteps(
      slug,
      mjWorktreePath,
      appName,
      ['checkVersion'],
      dbConfig,
      { ignoreVersionRange },
      env,
      sink
    );
    return (r.results?.checkVersion ?? { compatible: false }) as {
      compatible: boolean;
      overridden?: boolean;
      range?: string;
      mjVersion?: string;
    };
  }

  /**
   * Slice-4 active checksum-drift detection: Skyway `Validate()` against the app's
   * applied migrations vs disk. Returns `{ valid, errors }` — `valid:false` means an
   * already-applied versioned migration was edited (Migrate() would silently skip it).
   */
  async checkDrift(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<{ valid: boolean; errors: string[] }> {
    const r = await this.runSteps(
      slug,
      mjWorktreePath,
      appName,
      ['driftCheck'],
      dbConfig,
      {},
      env,
      sink
    );
    const d = (r.results?.driftCheck ?? {}) as {
      valid?: boolean;
      errors?: string[];
      skipped?: boolean;
    };
    return { valid: d.skipped ? true : d.valid === true, errors: d.errors ?? [] };
  }

  /**
   * Slice-4 destructive recovery — the correct fix for an edited versioned migration.
   * Skyway `Clean()` (drop all objects in the app schema) then `Migrate()` (re-apply
   * from disk). Confirm-gate this in the UI; it destroys app-schema data.
   */
  async resetAppSchema(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<EngineRunResult> {
    return this.runSteps(slug, mjWorktreePath, appName, ['resetSchema'], dbConfig, {}, env, sink);
  }

  /**
   * Slice-4 repair — Skyway `Repair()` realigns failed/baseline history rows. It does
   * NOT re-run SQL, so it does NOT fix an edited versioned migration (use
   * {@link resetAppSchema} for that). Surface that caveat in the UI.
   */
  async repairAppSchema(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    dbConfig: EngineDbConfig,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<EngineRunResult> {
    return this.runSteps(slug, mjWorktreePath, appName, ['repairSchema'], dbConfig, {}, env, sink);
  }

  /** DRY helper: run engine `steps` for an app's member, returning the engine result. */
  private async runSteps(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    steps: string[],
    dbConfig: EngineDbConfig,
    extra: { ignoreVersionRange?: boolean } = {},
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<EngineRunResult> {
    const memberPath = this.memberPathFor(mjWorktreePath, appName);
    await this.appRepos.addWorktreeExclude(mjWorktreePath, ENGINE_SCRATCH_EXCLUDE);
    const runner = this.runnerFor(mjWorktreePath);
    const result = await runner.run(
      slug,
      {
        steps,
        memberPath,
        manifestPath: path.join(memberPath, 'mj-app.json'),
        dbConfig,
        mjCoreSchema: '__mj',
        ignoreVersionRange: extra.ignoreVersionRange,
      },
      env,
      sink
    );
    if (!result.ok)
      throw new Error(`Engine steps [${steps.join(', ')}] failed: ${result.error ?? 'unknown'}`);
    return result;
  }

  /** True when no dev-app member directories remain under `packages/dev-apps`. */
  private async noDevAppMembersRemain(mjWorktreePath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(path.join(mjWorktreePath, 'packages', 'dev-apps'));
      return entries.filter(e => !e.startsWith('.')).length === 0;
    } catch {
      return true;
    }
  }

  /**
   * Slice-6 mandatory build: every boot entry resolves to `main: dist/index.js`
   * (dist is gitignored) — a cold dev-linked app boots stale/absent bytes unless
   * built. Build each of the app's workspace sub-packages (gated). Returns which
   * built and which failed; "ready" is gated on zero failures by the caller, and a
   * failure leaves last-good dist (never a silent stale serve).
   */
  async buildApp(
    slug: string,
    mjWorktreePath: string,
    appName: string,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<{ ok: boolean; built: string[]; failed: Array<{ name: string; error: string }> }> {
    const pkgs = (await this.appSubPackages(mjWorktreePath, appName)).filter(p => p.hasBuild);
    const built: string[] = [];
    let failed: Array<{ name: string; error: string }> = [];
    // Build in DEPENDENCY order without parsing the graph: a sub-package may depend
    // on a sibling that sorts later in directory order (e.g. Angular before Entities),
    // so iterate passes — each pass retries the not-yet-built packages — until a full
    // pass produces no new success. Whatever still fails then is a genuine error.
    let remaining = pkgs;
    let pass = 0;
    while (remaining.length) {
      pass++;
      const stillFailing: Array<{ pkg: (typeof pkgs)[number]; error: string }> = [];
      let progressed = false;
      for (const pkg of remaining) {
        emit(
          sink,
          slug,
          'app-build',
          'progress',
          `Building ${pkg.name}…${pass > 1 ? ` (pass ${pass})` : ''}`
        );
        const r = await run('npm', ['run', 'build', '--workspace', pkg.name], {
          cwd: mjWorktreePath,
          env,
          onOutput: s => emit(sink, slug, 'app-build', 'info', s.trimEnd()),
        });
        if (r.code === 0) {
          built.push(pkg.name);
          progressed = true;
        } else {
          stillFailing.push({
            pkg,
            error: (r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n'),
          });
        }
      }
      if (!progressed) {
        // No package built this pass → the rest have a real (non-ordering) failure.
        failed = stillFailing.map(s => ({ name: s.pkg.name, error: s.error }));
        break;
      }
      remaining = stillFailing.map(s => s.pkg);
    }
    const ok = failed.length === 0;
    emit(
      sink,
      slug,
      'app-build',
      ok ? 'success' : 'error',
      ok
        ? `Built ${built.length} app package(s)`
        : `Build failed: ${failed.map(f => f.name).join(', ')}`
    );
    return { ok, built, failed };
  }

  /**
   * Slice-6 watcher targets: the commands that rebuild an app's sub-package dist on
   * change (HMR/server-restart feed off rebuilt dist). Uses each package's own
   * `watch`/`build:watch` script when present, else falls back to `tsc --watch` for
   * tsc-built packages. Returned as launchable commands so the existing process
   * manager runs + tracks them (live-edit fidelity); no script → no watcher (flagged).
   */
  async appWatchTargets(
    mjWorktreePath: string,
    appName: string
  ): Promise<Array<{ name: string; cwd: string; command: string; args: string[]; note?: string }>> {
    const pkgs = await this.appSubPackages(mjWorktreePath, appName);
    return pkgs.map(pkg => {
      if (pkg.watchScript) {
        return { name: pkg.name, cwd: pkg.dir, command: 'npm', args: ['run', pkg.watchScript] };
      }
      if (pkg.buildScript === 'tsc') {
        return {
          name: pkg.name,
          cwd: pkg.dir,
          command: 'npx',
          args: ['tsc', '--watch', '--preserveWatchOutput'],
        };
      }
      return {
        name: pkg.name,
        cwd: pkg.dir,
        command: 'npm',
        args: ['run', 'build'],
        note: 'no watch script; manual rebuild only',
      };
    });
  }

  /** Discover an app's workspace sub-packages (name + build/watch script presence). */
  private async appSubPackages(
    mjWorktreePath: string,
    appName: string
  ): Promise<
    Array<{
      name: string;
      dir: string;
      hasBuild: boolean;
      buildScript?: string;
      watchScript?: string;
    }>
  > {
    const pkgsDir = path.join(this.memberPathFor(mjWorktreePath, appName), 'packages');
    const out: Array<{
      name: string;
      dir: string;
      hasBuild: boolean;
      buildScript?: string;
      watchScript?: string;
    }> = [];
    let entries: string[] = [];
    try {
      entries = await fs.readdir(pkgsDir);
    } catch {
      return out;
    }
    for (const e of entries) {
      const dir = path.join(pkgsDir, e);
      const raw = await this.readFileSafe(path.join(dir, 'package.json'));
      if (!raw) continue;
      const pkg = JSON.parse(raw) as { name?: string; scripts?: Record<string, string> };
      if (!pkg.name) continue;
      const scripts = pkg.scripts ?? {};
      out.push({
        name: pkg.name,
        dir,
        hasBuild: !!scripts.build,
        buildScript: scripts.build,
        watchScript: scripts.watch ? 'watch' : scripts['build:watch'] ? 'build:watch' : undefined,
      });
    }
    return out;
  }

  /** Read + minimally type a member's `mj-app.json`. */
  async readManifest(memberPath: string): Promise<AppManifestLite> {
    const raw = await fs.readFile(path.join(memberPath, 'mj-app.json'), 'utf8');
    return JSON.parse(raw) as AppManifestLite;
  }

  /**
   * Capture a normalized, oracle-diffable snapshot of an app's install footprint in
   * the worktree (config + package.json deps + angular excludes + client bootstrap).
   * Slice-5 diffs this against a snapshot of a real `mj app install` (the golden);
   * here it underpins the dev↔install round-trip identity check (Slice 3) and the
   * structural self-checks.
   */
  async captureParitySnapshot(mjWorktreePath: string, appName: string): Promise<ParitySnapshot> {
    const memberPath = this.memberPathFor(mjWorktreePath, appName);
    const manifest = await this.readManifest(memberPath).catch(() => undefined);
    const declared = new Set<string>([
      ...(manifest?.packages?.server ?? []).map(p => p.name),
      ...(manifest?.packages?.shared ?? []).map(p => p.name),
    ]);
    const declaredClient = new Set<string>([
      ...(manifest?.packages?.client ?? []).map(p => p.name),
      ...(manifest?.packages?.shared ?? []).map(p => p.name),
    ]);

    const config = await this.readFileSafe(path.join(mjWorktreePath, 'mj.config.cjs'));
    const dynamicServerLines = this.extractDynamicServerEntries(config, manifest?.name);
    const entityPackageEntries = this.extractEntityPackageEntries(config, manifest?.schema?.name);

    return {
      appName,
      schema: manifest?.schema?.name,
      dynamicServerLines,
      entityPackageEntries,
      serverDeps: await this.depsFor(
        path.join(mjWorktreePath, 'packages', 'MJAPI', 'package.json'),
        declared
      ),
      clientDeps: await this.depsFor(
        path.join(mjWorktreePath, 'packages', 'MJExplorer', 'package.json'),
        declaredClient
      ),
      prebundleExcludes: await this.prebundleExcludes(
        path.join(mjWorktreePath, 'packages', 'MJExplorer', 'angular.json')
      ),
      clientBootstrapImports: await this.clientBootstrapImports(
        path.join(
          mjWorktreePath,
          'packages',
          'MJExplorer',
          'src',
          'app',
          'generated',
          'open-app-bootstrap.generated.ts'
        )
      ),
    };
  }

  private async readFileSafe(file: string): Promise<string> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return '';
    }
  }

  /** Declared-app deps from a package.json, preserving key order (parity-relevant). */
  private async depsFor(pkgFile: string, declared: Set<string>): Promise<string[]> {
    const raw = await this.readFileSafe(pkgFile);
    if (!raw) return [];
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
    const deps = pkg.dependencies ?? {};
    return Object.keys(deps)
      .filter(k => declared.has(k))
      .map(k => `${k}@${deps[k]}`);
  }

  /**
   * Extract the `dynamicPackages.server` entries belonging to an app, keyed by the
   * manifest NAME (which is what `AddServerDynamicPackages` writes as `AppName`),
   * normalized to `PackageName|StartupExport|Enabled` and sorted for stable diffing.
   */
  private extractDynamicServerEntries(config: string, appConfigName?: string): string[] {
    if (!appConfigName) return [];
    const out: string[] = [];
    const objRe = /\{[^{}]*?AppName\s*:\s*'([^']+)'[^{}]*?\}/g;
    let m: RegExpExecArray | null;
    while ((m = objRe.exec(config)) !== null) {
      if (m[1] !== appConfigName) continue;
      const obj = m[0];
      const pkg = /PackageName\s*:\s*'([^']*)'/.exec(obj)?.[1] ?? '';
      const exp = /StartupExport\s*:\s*'([^']*)'/.exec(obj)?.[1] ?? '';
      const enabled = /Enabled\s*:\s*(true|false)/.exec(obj)?.[1] ?? '';
      out.push(`${pkg}|${exp}|${enabled}`);
    }
    return out.sort();
  }

  private extractEntityPackageEntries(config: string, schema?: string): string[] {
    if (!schema) return [];
    const out: string[] = [];
    const re = /'([^']+)'\s*:\s*'([^']+)'/g;
    const section = config.slice(config.indexOf('entityPackageName'));
    let m: RegExpExecArray | null;
    while ((m = re.exec(section)) !== null) {
      if (m[1] === schema) out.push(`${m[1]}=${m[2]}`);
    }
    return out.sort();
  }

  private async prebundleExcludes(angularFile: string): Promise<string[]> {
    const raw = await this.readFileSafe(angularFile);
    if (!raw) return [];
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const found = new Set<string>();
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        const rec = node as Record<string, unknown>;
        const pre = rec.prebundle as { exclude?: unknown } | undefined;
        if (pre && Array.isArray(pre.exclude)) for (const e of pre.exclude) found.add(String(e));
        for (const v of Object.values(rec)) walk(v);
      };
      walk(json);
      return [...found].sort();
    } catch {
      return [];
    }
  }

  private async clientBootstrapImports(file: string): Promise<string[]> {
    const raw = await this.readFileSafe(file);
    if (!raw) return [];
    return raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('import ') && !l.startsWith('//'))
      .map(l => l.replace(/^import\s+['"]/, '').replace(/['"];?$/, ''));
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
