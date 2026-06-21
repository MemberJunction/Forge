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
import { addEntityPackageMapping } from './entityPackageMapping.js';

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
    sink: EventSink = noopSink
  ): Promise<EngineRunResult> {
    const memberPath = this.memberPathFor(mjWorktreePath, appName);
    // Keep the engine scratch dir out of the worktree's git status.
    await this.appRepos.addWorktreeExclude(mjWorktreePath, ENGINE_SCRATCH_EXCLUDE);
    const runner = new WorktreeEngineRunner(mjWorktreePath);
    emit(sink, slug, 'app-link', 'progress', `Provisioning ${appName} schema + migrations…`);
    const result = await runner.run(
      slug,
      {
        steps: ['ensureSchema', 'migrate', 'schemaInfo'],
        memberPath,
        manifestPath: path.join(memberPath, 'mj-app.json'),
        dbConfig,
        mjCoreSchema: '__mj',
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
    const runner = new WorktreeEngineRunner(mjWorktreePath);
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
