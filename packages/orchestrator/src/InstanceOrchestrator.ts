import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  InstanceConfig,
  InstanceRecord,
  InstanceSecrets,
  ManagedProcess,
  RunOption,
  SetupStep,
} from '@mj-forge/shared';
import { resolvePaths, type OrchestratorOptions, type ResolvedPaths } from './paths.js';
import type { AppAccessEntry, DevPersona } from '@mj-forge/shared';
import { InstanceStore } from './InstanceStore.js';
import { PersonaStore } from './PersonaStore.js';
import { IdentityManager } from './IdentityManager.js';
import { PortAllocator } from './PortAllocator.js';
import { DockerManager } from './DockerManager.js';
import { SharedSqlServer } from './SharedSqlServer.js';
import { WorktreeManager } from './WorktreeManager.js';
import { RepoManager } from './RepoManager.js';
import { OpenAppManager, type AppDependency } from './OpenAppManager.js';
import {
  reconcileInstanceEditorArtifacts,
  resolveEditorTarget,
  ensureInstanceWorkLogs,
} from './WorkspaceArtifacts.js';
import { ConfigWriter } from './ConfigWriter.js';
import { SetupRunner, FULL_SETUP_ORDER, setupFlagForStep } from './SetupRunner.js';
import { ProcessManager, type LaunchTarget } from './ProcessManager.js';
import { buildSetupScript, buildDropDatabaseScript } from './dbBootstrap.js';
import { resolveNodeForWorktree, envWithNode } from './nodeEnv.js';
import {
  emit,
  type EventSink,
  noopSink,
  slugify,
  newId,
  generateEncryptionKey,
  generateApiToken,
  generateRsaKeyPair,
} from './util.js';

export interface CreateResult {
  record: InstanceRecord;
}

/**
 * The single orchestration API used by BOTH the GUI (via IPC handlers) and the
 * `mjdev` CLI. Composes the focused managers into instance lifecycle operations
 * and streams progress through an {@link EventSink}.
 */
export class InstanceOrchestrator {
  readonly paths: ResolvedPaths;
  private readonly store: InstanceStore;
  private readonly personas: PersonaStore;
  private readonly identity: IdentityManager;
  private readonly docker: DockerManager;
  /** The one shared SQL Server backing every instance in this workspace. */
  private readonly server: SharedSqlServer;
  private readonly worktrees: WorktreeManager;
  private readonly repo: RepoManager;
  /** Open-app dev-linking (Phase B). */
  private readonly openApps: OpenAppManager;
  /** True when worktrees come from the app-managed clone (vs. an overridden repo). */
  private readonly usingManagedClone: boolean;
  private readonly config: ConfigWriter;
  private readonly setup: SetupRunner;
  private readonly procs: ProcessManager;

  constructor(options: OrchestratorOptions = {}, docker?: DockerManager) {
    this.paths = resolvePaths(options);
    this.store = new InstanceStore(this.paths);
    this.personas = new PersonaStore(this.paths);
    this.docker = docker ?? new DockerManager(undefined, this.paths.containerPrefix);
    this.server = new SharedSqlServer(this.docker, this.store, this.paths);
    this.identity = new IdentityManager(this.store, this.personas, this.docker);
    this.worktrees = new WorktreeManager(this.paths.mjRepoPath);
    this.repo = new RepoManager(this.paths.mjClonePath, this.paths.mjSourcePath);
    this.openApps = new OpenAppManager(this.paths);
    this.usingManagedClone = this.paths.mjRepoPath === this.paths.mjClonePath;
    this.config = new ConfigWriter();
    this.setup = new SetupRunner();
    this.procs = new ProcessManager(this.paths);
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  list(): Promise<InstanceRecord[]> {
    return this.store.list();
  }

  async info(slug: string): Promise<{
    record: InstanceRecord;
    containerState?: string;
    processes: ManagedProcess[];
    nodeVersion?: string;
  }> {
    const record = await this.requireRecord(slug);
    const containerState = await this.docker.getState(record.container.name).catch(() => undefined);
    const nodeVersion = resolveNodeForWorktree(record.worktreePath, record.node).version;
    return { record, containerState, processes: await this.procs.list(slug), nodeVersion };
  }

  // ── Create (provision-only) with rollback saga ────────────────────────────

  async create(config: InstanceConfig, sink: EventSink = noopSink): Promise<CreateResult> {
    const existing = await this.store.list();
    const slug = await this.uniqueSlug(config.name, existing);
    emit(sink, slug, 'create', 'progress', `Provisioning instance "${config.name}"…`);

    await this.docker.assertAvailable();
    // Ensure the app-managed MJ clone exists (seeded once from the local
    // checkout) before any worktree is cut from it.
    if (this.usingManagedClone) await this.repo.ensureCentralClone(slug, sink);
    await this.worktrees.assertRepo();

    // Ensure the workspace's single shared SQL Server (created on the first
    // instance, reused thereafter). Every instance's database lives here.
    const server = await this.server.ensure(sink);

    // Reserve ports already published by any Docker container so we never
    // collide. SQL is fixed to the shared server's port; only api/explorer are
    // striped per instance.
    const reserved = await this.docker.listPublishedHostPorts().catch(() => []);
    const ports = await PortAllocator.allocate(
      existing.map(i => i.ports),
      config.ports,
      reserved,
      server.port
    );
    const branch = config.branch?.trim() || `mjdev/${slug}`;
    const baseRef = config.baseRef?.trim() || 'HEAD';
    const dbName = config.database?.name?.trim() || `MJ_${slug.replace(/-/g, '_')}`;
    // Unified layout: each instance owns a folder holding its MJ worktree (and,
    // in Phase B, its open-app worktrees + config) side by side.
    const worktreePath = path.join(this.paths.instancesRootDir, slug, 'mj');
    const secretsRef = slug;

    // DB credentials are SHARED across the workspace's single server (the login
    // names are fixed, so one password per login is the only coherent model) —
    // copied from server.json into this instance's secrets so ConfigWriter and
    // IdentityManager read them unchanged. App-level keys (encryption, magic-link)
    // stay per-instance. `sa` is bootstrap/admin only — never used for app access.
    const secrets: InstanceSecrets = {
      saPassword: server.saPassword,
      dbUsername: 'MJ_Connect',
      dbPassword: server.dbPassword,
      codegenUsername: 'MJ_CodeGen',
      codegenPassword: server.codegenPassword,
      encryptionKey: generateEncryptionKey(),
      // Phase 2 local dev auth: system Owner key + magic-link signing key.
      systemApiKey: generateApiToken(),
      magicLinkPrivateKey: generateRsaKeyPair(),
    };

    const record: InstanceRecord = {
      id: newId(),
      slug,
      name: config.name,
      branch,
      baseRef,
      worktreePath,
      // References the workspace's shared SQL Server (one DB per instance).
      container: {
        name: server.containerName,
        volume: server.volume,
      },
      ports,
      dbName,
      secretsRef,
      status: 'provisioning',
      setup: {
        configWritten: false,
        depsInstalled: false,
        migrated: false,
        codegen: false,
        built: false,
      },
      node: config.node ?? 'auto',
      // Single open-app mode for the instance (dev-link primary). Enforces a pure
      // topology — every app added uses this mode unless a power user overrides.
      appMode: config.appMode ?? 'dev',
      createdAt: new Date().toISOString(),
    };

    // Persist intent up-front so the UI can show a provisioning row.
    await this.store.setSecrets(secretsRef, secrets);
    await this.store.writeConfig(slug, {
      ...config,
      branch,
      baseRef,
      ports,
      database: { name: dbName, saPassword: 'auto' },
      node: record.node,
    });
    await this.store.upsert(record);

    const rollback: Array<() => Promise<void>> = [];
    try {
      // 1) This instance's database, least-privilege logins (shared, idempotent),
      // users, and role grants — created on the already-running shared server.
      // Rollback drops only THIS database; the shared server/volume is never
      // touched (other instances live there).
      emit(sink, slug, 'create', 'progress', 'Creating database, logins, and roles…');
      await this.docker.execSql(
        server.containerName,
        server.saPassword,
        buildSetupScript({
          dbName,
          codeGenUser: secrets.codegenUsername,
          codeGenPassword: secrets.codegenPassword,
          apiUser: secrets.dbUsername,
          apiPassword: secrets.dbPassword,
        }),
        slug,
        sink
      );
      rollback.push(() =>
        this.docker.execSql(
          server.containerName,
          server.saPassword,
          buildDropDatabaseScript(dbName),
          slug,
          noopSink
        )
      );

      // 2) Git worktree
      await this.worktrees.add(worktreePath, branch, baseRef, slug, sink);
      rollback.push(() => this.worktrees.remove(worktreePath, slug));

      // 3) Config files
      const written = await this.config.write(worktreePath, record, secrets);
      record.setup.configWritten = true;
      emit(sink, slug, 'create', 'info', `Wrote ${written.length} config file(s)`);

      // Per-instance agent work logs (TASKS/BACKLOG/BUGS) — best-effort, never clobbered.
      ensureInstanceWorkLogs(worktreePath, slug);

      // Report the Node version setup/build/serve will use (from the worktree's .nvmrc).
      const node = resolveNodeForWorktree(worktreePath, record.node);
      if (node.version) {
        emit(
          sink,
          slug,
          'create',
          'info',
          `Node ${node.version} (${node.source}) will run setup/build/serve`
        );
      }

      record.status = 'running';
      await this.store.upsert(record);
      emit(
        sink,
        slug,
        'create',
        'success',
        `Instance "${slug}" provisioned (SQL :${ports.sql}, API :${ports.api}, Explorer :${ports.explorer})`
      );
      return { record };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit(sink, slug, 'create', 'error', `Provisioning failed: ${message}. Rolling back…`);
      for (const undo of rollback.reverse()) await undo().catch(() => {});
      await this.store.remove(slug).catch(() => {});
      await this.store.deleteConfig(slug).catch(() => {});
      await this.store.deleteSecrets(secretsRef).catch(() => {});
      throw new Error(message);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start(slug: string, sink: EventSink = noopSink): Promise<InstanceRecord> {
    const record = await this.requireRecord(slug);
    await this.docker.assertAvailable();
    // "Starting" an instance ensures the shared SQL Server is up (it may have
    // been stopped) and accepting logins; the API/Explorer are launched on
    // demand via `run`. ensure() starts the container if stopped and waits ready.
    emit(sink, slug, 'start', 'progress', 'Ensuring shared SQL Server is running…');
    await this.server.ensure(sink);
    record.status = 'running';
    await this.store.upsert(record);
    emit(sink, slug, 'start', 'success', 'Instance started');
    return record;
  }

  async stop(slug: string, sink: EventSink = noopSink): Promise<InstanceRecord> {
    const record = await this.requireRecord(slug);
    emit(sink, slug, 'stop', 'progress', 'Stopping services…');
    await this.procs.stopForInstance(slug);
    // The SQL Server is shared across instances — never stop it here; other
    // instances (and other agents) depend on it. Only this instance's services
    // are stopped. Use `mjdev reset` to tear the shared server down explicitly.
    record.status = 'stopped';
    await this.store.upsert(record);
    emit(sink, slug, 'stop', 'success', 'Instance stopped');
    return record;
  }

  async delete(slug: string, sink: EventSink = noopSink): Promise<void> {
    const record = await this.requireRecord(slug);
    emit(sink, slug, 'delete', 'progress', 'Deleting instance…');
    await this.procs.stopForInstance(slug);
    const secrets = await this.store.getSecrets(record.secretsRef);
    const server = await this.store.getServer();
    // A pre-consolidation ("legacy") record points at its OWN per-instance
    // container, not the shared server. Detect that and clean it the old way —
    // remove the container + volume — so a cutover leaves no orphan. A
    // new-model record drops only its database; the shared server stays up for
    // every other instance.
    const isLegacy = !server || record.container.name !== server.containerName;
    if (isLegacy) {
      emit(sink, slug, 'delete', 'progress', `Removing legacy container ${record.container.name}…`);
      await this.docker.remove(record.container.name, record.container.volume).catch(() => {});
    } else {
      const saPassword = secrets?.saPassword ?? server.saPassword;
      emit(sink, slug, 'delete', 'progress', `Dropping database ${record.dbName}…`);
      await this.docker
        .execSql(
          server.containerName,
          saPassword,
          buildDropDatabaseScript(record.dbName),
          slug,
          noopSink
        )
        .catch(() => {});
    }
    await this.worktrees.remove(record.worktreePath, slug, sink).catch(() => {});
    await this.removeInstanceDir(record.worktreePath).catch(() => {});
    await this.store.remove(slug);
    await this.store.deleteConfig(slug);
    await this.store.deleteSecrets(record.secretsRef);
    await this.store.deleteMintedKeys(record.secretsRef);
    emit(sink, slug, 'delete', 'success', 'Instance deleted');
  }

  /**
   * Full teardown of the workspace's SQL footprint — removes the shared SQL
   * Server container + volume and forgets its record, AND sweeps any leftover
   * per-instance containers from the pre-consolidation model (`<prefix>-<slug>`)
   * so a cutover leaves nothing orphaned. Called by `mjdev reset`. Destructive:
   * every database on the shared server is destroyed with it, so callers must
   * have deleted/abandoned all instances first.
   */
  async teardownServer(sink: EventSink = noopSink): Promise<void> {
    // Legacy per-instance containers (one SQL Server each) from before instances
    // shared a server — remove them and their `<name>-data` volumes.
    const legacy = await this.docker.listManaged().catch(() => []);
    for (const c of legacy) {
      emit(sink, c.slug, 'docker', 'progress', `Removing legacy container ${c.name}…`);
      await this.docker.remove(c.name, `${c.name}-data`).catch(() => {});
    }
    const server = await this.store.getServer();
    if (server) {
      emit(
        sink,
        server.containerName,
        'docker',
        'progress',
        `Removing shared SQL Server ${server.containerName}…`
      );
      await this.docker.remove(server.containerName, server.volume).catch(() => {});
      await this.store.deleteServer().catch(() => {});
    }
  }

  // ── Developer identity (Phase 2) ──────────────────────────────────────────

  listPersonas(): Promise<DevPersona[]> {
    return this.personas.list();
  }

  getActivePersona(): Promise<DevPersona | undefined> {
    return this.personas.getActive();
  }

  savePersona(persona: Omit<DevPersona, 'id'> & { id?: string }): Promise<DevPersona> {
    return this.personas.save(persona);
  }

  removePersona(id: string): Promise<void> {
    return this.personas.remove(id);
  }

  setActivePersona(id: string): Promise<void> {
    return this.personas.setActive(id);
  }

  /** Set or clear ({@link id} = undefined) an instance's persona override. */
  async setInstancePersona(slug: string, id: string | undefined): Promise<InstanceRecord> {
    const record = await this.requireRecord(slug);
    record.personaId = id;
    await this.store.upsert(record);
    return record;
  }

  /** The persona an instance currently acts as (override or global active). */
  async whoami(slug: string): Promise<DevPersona> {
    return this.identity.resolvePersona(await this.requireRecord(slug));
  }

  /** Mint (or return the cached) `mj_sk_*` API key for the instance's persona. */
  async mintApiKey(slug: string, sink: EventSink = noopSink, force = false): Promise<string> {
    const record = await this.requireRecord(slug);
    const persona = await this.identity.resolvePersona(record);
    return this.identity.mintApiKey(record, persona, sink, force);
  }

  /** Mint a magic-link session and return a logged-in Explorer URL. */
  async openExplorerAs(slug: string, sink: EventSink = noopSink): Promise<string> {
    const record = await this.requireRecord(slug);
    const persona = await this.identity.resolvePersona(record);
    return this.identity.openExplorerAs(record, persona, sink);
  }

  /** List the instance's apps with the current persona's access state. */
  async listAppAccess(slug: string): Promise<AppAccessEntry[]> {
    const record = await this.requireRecord(slug);
    const persona = await this.identity.resolvePersona(record);
    return this.identity.listApps(record, persona);
  }

  /**
   * Toggle one app on/off for the instance's persona and return the refreshed
   * list. Persists on the persona (default-on; only exceptions are stored).
   */
  async setAppAccess(
    slug: string,
    appName: string,
    granted: boolean,
    sink: EventSink = noopSink
  ): Promise<AppAccessEntry[]> {
    const record = await this.requireRecord(slug);
    const persona = await this.identity.resolvePersona(record);
    return this.identity.setAppAccess(record, persona, appName, granted, sink);
  }

  /**
   * Regenerate an existing instance's config files and backfill any missing
   * auth secrets (system API key, magic-link signing key). Lets instances
   * created before Phase 2 pick up `.env`/`mj.config.cjs`/Explorer auth without
   * re-provisioning. Returns the paths written.
   */
  async regenerateConfig(slug: string, sink: EventSink = noopSink): Promise<string[]> {
    const record = await this.requireRecord(slug);
    const current = await this.store.getSecrets(record.secretsRef);
    if (!current) throw new Error(`No secrets found for instance "${slug}"`);
    const secrets: InstanceSecrets = {
      ...current,
      // Preserve an existing base encryption key at all costs — regenerating it would
      // make every previously-encrypted field in this instance undecryptable. Only mint
      // one when a (pre-encryption) instance has none. Same preserve-if-present rule for
      // the system API key + magic-link signing key.
      encryptionKey: current.encryptionKey || generateEncryptionKey(),
      systemApiKey: current.systemApiKey || generateApiToken(),
      magicLinkPrivateKey: current.magicLinkPrivateKey || generateRsaKeyPair(),
    };
    if (
      secrets.encryptionKey !== current.encryptionKey ||
      secrets.systemApiKey !== current.systemApiKey ||
      secrets.magicLinkPrivateKey !== current.magicLinkPrivateKey
    ) {
      await this.store.setSecrets(record.secretsRef, secrets);
    }
    const written = await this.config.write(record.worktreePath, record, secrets);
    record.setup.configWritten = true;
    await this.store.upsert(record);
    emit(sink, slug, 'config', 'success', `Regenerated ${written.length} config file(s)`);
    return written;
  }

  // ── Branch sync (no switching — diverging migrations make that unsafe) ─────

  /** Pull the instance's MJ worktree branch from its remote upstream (fast-forward only). */
  async pullInstance(
    slug: string,
    sink: EventSink = noopSink
  ): Promise<{ updated: boolean; message: string }> {
    const record = await this.requireRecord(slug);
    emit(sink, slug, 'git-pull', 'progress', `Pulling ${record.branch}…`);
    const result = await this.worktrees.pull(record.worktreePath);
    emit(sink, slug, 'git-pull', result.updated ? 'success' : 'info', result.message);
    return result;
  }

  /**
   * Merge the instance's base branch (what it was created from) into its worktree branch —
   * the way to pick up commits that landed on the base (e.g. MJ wiring fixes). Re-run
   * migrate + build afterward to apply schema/code changes the merge brought in.
   */
  async mergeInstanceFromBase(
    slug: string,
    sink: EventSink = noopSink
  ): Promise<{ updated: boolean; message: string }> {
    const record = await this.requireRecord(slug);
    if (!record.baseRef) {
      throw new Error(
        `Instance "${slug}" has no recorded base branch (created before base tracking) — ` +
          `make a fresh instance to pick up base-branch changes.`
      );
    }
    emit(sink, slug, 'git-merge', 'progress', `Merging ${record.baseRef} into ${record.branch}…`);
    const result = await this.worktrees.mergeBaseRef(record.worktreePath, record.baseRef);
    emit(sink, slug, 'git-merge', result.updated ? 'success' : 'info', result.message);
    return result;
  }

  // ── Open apps (Phase B dev-linking) ───────────────────────────────────────

  /** Build the engine DB config (codegen login) for an instance from its secrets. */
  private async appDbConfig(record: InstanceRecord): Promise<{
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    trustServerCertificate: boolean;
  }> {
    const secrets = await this.store.getSecrets(record.secretsRef);
    if (!secrets) throw new Error(`No secrets for instance "${record.slug}"`);
    return {
      host: 'localhost',
      port: record.ports.sql,
      database: record.dbName,
      user: secrets.codegenUsername,
      password: secrets.codegenPassword,
      trustServerCertificate: true,
    };
  }

  /** Dev-link an open app (GitHub URL or local path) into an instance. */
  async linkApp(
    slug: string,
    appRef: string,
    opts: {
      ignoreVersionRange?: boolean;
      allowDoubleUnderscore?: boolean;
      appBranch?: string;
      baseRef?: string;
    } = {},
    sink: EventSink = noopSink
  ): Promise<{ appName: string; snapshot: unknown }> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    const r = await this.openApps.linkApp(
      slug,
      record.worktreePath,
      appRef,
      dbConfig,
      { ...opts, env },
      sink
    );
    await this.reconcileEditorArtifacts(slug, record.worktreePath);
    return { appName: r.appName, snapshot: r.snapshot };
  }

  /**
   * Resolve an app's direct open-app dependencies (for the dev-link pre-flight popup):
   * which apps it needs and which are already Active in the instance. The renderer
   * prompts per missing dep (install vs dev-link) before dev-linking the app.
   */
  async resolveAppDependencies(
    slug: string,
    appRef: string,
    sink: EventSink = noopSink
  ): Promise<{ appName: string; dependencies: AppDependency[] }> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    return this.openApps.resolveDevLinkDependencies(
      slug,
      record.worktreePath,
      appRef,
      dbConfig,
      env,
      sink
    );
  }

  /**
   * Plain-install an open app (the real `mj app install`) from a GitHub URL into an
   * instance — distinct from {@link linkApp}. The engine pulls the app + its full
   * transitive open-app dependency graph as published releases. Use for dependencies
   * you only consume (e.g. install `bizapps-common`, then dev-link `bizapps-accounting`).
   */
  async installApp(
    slug: string,
    source: string,
    opts: { version?: string; allowDoubleUnderscore?: boolean } = {},
    sink: EventSink = noopSink
  ): Promise<{ appName: string; version: string }> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    const res = await this.openApps.installApp(
      slug,
      record.worktreePath,
      source,
      dbConfig,
      { ...opts, env },
      sink
    );
    await this.reconcileEditorArtifacts(slug, record.worktreePath);
    return res;
  }

  /**
   * Remove an app from an instance, **dispatching by mode**: a dev-linked app is torn
   * down via {@link unlinkApp} (reproduced reversal); an installed app via the engine's
   * `RemoveApp`. Universal entry for CLI/agents that don't track mode. Drops the schema
   * by default (`keepData` to preserve); `force` removes even if other apps depend on it.
   */
  async removeApp(
    slug: string,
    appName: string,
    opts: { keepData?: boolean; force?: boolean } = {},
    sink: EventSink = noopSink
  ): Promise<void> {
    const record = await this.requireRecord(slug);
    const apps = await this.openApps.listApps(slug);
    const mode = apps.find(a => a.appName === appName)?.mode;
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    if (mode === 'installed') {
      await this.openApps.removeInstalledApp(
        slug,
        record.worktreePath,
        appName,
        dbConfig,
        { keepData: opts.keepData, force: opts.force, env },
        sink
      );
    } else {
      // Dev-linked (or unknown) → unlink. keepData maps to NOT dropping the schema.
      await this.openApps.unlinkApp(
        slug,
        record.worktreePath,
        appName,
        dbConfig,
        { dropSchema: !opts.keepData, env },
        sink
      );
    }
    await this.reconcileEditorArtifacts(slug, record.worktreePath);
  }

  /** Reverse a dev-link (optionally dropping the app schema). */
  async unlinkApp(
    slug: string,
    appName: string,
    opts: { dropSchema?: boolean } = {},
    sink: EventSink = noopSink
  ): Promise<void> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    await this.openApps.unlinkApp(
      slug,
      record.worktreePath,
      appName,
      dbConfig,
      { ...opts, env },
      sink
    );
  }

  /** Toggle an app between dev (local source) and installed (published) resolution. */
  async switchAppMode(
    slug: string,
    appName: string,
    target: 'dev' | 'installed',
    sink: EventSink = noopSink
  ): Promise<void> {
    const record = await this.requireRecord(slug);
    const env = this.instanceEnv(record, slug, sink);
    await this.openApps.switchMode(slug, record.worktreePath, appName, target, { env }, sink);
    await this.reconcileEditorArtifacts(slug, record.worktreePath);
  }

  /** List the apps dev-linked into an instance (Forge overlay state). */
  listApps(slug: string): Promise<
    Array<{
      appName: string;
      mode: string;
      appRef: string;
      ignoreVersionRangeUsed: boolean;
      linkedBranch?: string;
      setup?: { migrated?: boolean; codegen?: boolean; built?: boolean; synced?: boolean };
    }>
  > {
    return this.openApps.listApps(slug);
  }

  /**
   * Bring a dev-linked app to ready in one step, in the order MJ's metadata config
   * implies (directoryOrder puts schema-info/entities before data): migrate →
   * **sync → codegen** → build. Sync runs BEFORE codegen so the app's authored
   * metadata (Schema Info / Entities with their fixed IDs) lands first and codegen
   * finds it instead of creating conflicting rows; sync failures are non-fatal
   * (a re-run after codegen collides — expected) so the chain still completes.
   */
  async setupApp(
    slug: string,
    appName: string,
    sink: EventSink = noopSink
  ): Promise<{ ok: boolean; steps: Record<string, boolean> }> {
    const steps: Record<string, boolean> = {};
    const m = await this.migrateApp(slug, appName, sink);
    steps.migrate = m.ok;
    if (!m.ok) return { ok: false, steps };
    // Sync the app's own reference data (best-effort; app-scoped, additive).
    const s = await this.syncApp(slug, appName, {}, sink).catch(() => ({ ok: false }));
    steps.sync = s.ok;
    // NOTE: codegen is deliberately NOT run here — mirrors instance `setup all` (ADR-007).
    // A dev-linked app ships its committed generated code (Entities/Server/Actions
    // `src/generated`), so `build` compiles against that. Re-running codegen at setup is
    // redundant and can CLOBBER the committed generated files if the DB lacks app metadata.
    // Run codegen ON-DEMAND (`codegenApp` / `mjdev app codegen`) only after you change the
    // app's schema/metadata, then commit the regenerated code.
    const b = await this.buildApp(slug, appName, sink);
    steps.build = b.ok;
    return { ok: b.ok, steps };
  }

  /** Recently-used app refs across instances (for the add-app dropdown), newest first. */
  recentApps(): Promise<string[]> {
    return this.openApps.recentApps();
  }

  /** Detect checksum drift in a dev-linked app's applied migrations. */
  async checkAppDrift(
    slug: string,
    appName: string,
    sink: EventSink = noopSink
  ): Promise<{ valid: boolean; errors: string[] }> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    return this.openApps.checkDrift(slug, record.worktreePath, appName, dbConfig, env, sink);
  }

  /** Destructively reset an app's schema (Clean + re-migrate) — fixes edited migrations. */
  async resetAppSchema(slug: string, appName: string, sink: EventSink = noopSink): Promise<void> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    await this.openApps.resetAppSchema(slug, record.worktreePath, appName, dbConfig, env, sink);
  }

  /** Repair an app's migration history (realign failed/baseline rows; no SQL re-run). */
  async repairAppSchema(slug: string, appName: string, sink: EventSink = noopSink): Promise<void> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    await this.openApps.repairAppSchema(slug, record.worktreePath, appName, dbConfig, env, sink);
  }

  /** Build a dev-linked app's workspace sub-packages (required before boot). */
  async buildApp(
    slug: string,
    appName: string,
    sink: EventSink = noopSink
  ): Promise<{ ok: boolean; built: string[]; failed: Array<{ name: string; error: string }> }> {
    const record = await this.requireRecord(slug);
    const env = this.instanceEnv(record, slug, sink);
    return this.openApps.buildApp(slug, record.worktreePath, appName, env, sink);
  }

  /** Rebuild ALL dev-linked apps in an instance, in cross-app dependency order. */
  async buildAllApps(
    slug: string,
    sink: EventSink = noopSink
  ): Promise<{
    ok: boolean;
    apps: Array<{
      appName: string;
      ok: boolean;
      built: string[];
      failed: Array<{ name: string; error: string }>;
    }>;
  }> {
    const record = await this.requireRecord(slug);
    const env = this.instanceEnv(record, slug, sink);
    return this.openApps.buildAllApps(slug, record.worktreePath, env, sink);
  }

  /** Re-run a dev-linked app's schema migrations (apply newly-added migration files). */
  async migrateApp(
    slug: string,
    appName: string,
    sink: EventSink = noopSink
  ): Promise<{ ok: boolean; error?: string }> {
    const record = await this.requireRecord(slug);
    const dbConfig = await this.appDbConfig(record);
    const env = this.instanceEnv(record, slug, sink);
    const r = await this.openApps.migrateApp(
      slug,
      record.worktreePath,
      appName,
      dbConfig,
      env,
      sink
    );
    return { ok: r.ok, error: r.error };
  }

  /** Regenerate a dev-linked app's entities from the instance DB + rebuild (open-app codegen). */
  async codegenApp(
    slug: string,
    appName: string,
    sink: EventSink = noopSink
  ): Promise<{ ok: boolean; error?: string }> {
    const record = await this.requireRecord(slug);
    const env = this.instanceEnv(record, slug, sink);
    return this.openApps.codegenApp(slug, record.worktreePath, appName, env, sink);
  }

  /** Push (or pull/status) a dev-linked app's metadata seed (e.g. currencies) via `mj sync`. */
  async syncApp(
    slug: string,
    appName: string,
    opts: { dir?: string; include?: string; mode?: 'push' | 'pull' | 'status' } = {},
    sink: EventSink = noopSink
  ): Promise<{ ok: boolean; error?: string }> {
    const record = await this.requireRecord(slug);
    const env = this.instanceEnv(record, slug, sink);
    return this.openApps.syncApp(slug, record.worktreePath, appName, env, sink, opts);
  }

  /** Launchable watcher targets for a dev-linked app (live-edit rebuild). */
  async appWatchTargets(
    slug: string,
    appName: string
  ): Promise<Array<{ name: string; cwd: string; command: string; args: string[]; note?: string }>> {
    const record = await this.requireRecord(slug);
    return this.openApps.appWatchTargets(record.worktreePath, appName);
  }

  // ── Setup steps ───────────────────────────────────────────────────────────

  async runSetup(
    slug: string,
    step: SetupStep | 'all',
    sink: EventSink = noopSink
  ): Promise<InstanceRecord> {
    const record = await this.requireRecord(slug);
    const env = this.instanceEnv(record, slug, sink);
    if (step === 'all') {
      const alreadyDone = FULL_SETUP_ORDER.filter(s => record.setup[setupFlagForStep(s)]);
      await this.setup.runFullSetup(
        record.worktreePath,
        slug,
        sink,
        async done => {
          record.setup[setupFlagForStep(done)] = true;
          await this.store.upsert(record);
        },
        alreadyDone,
        env
      );
    } else {
      const result = await this.setup.runStep(step, record.worktreePath, slug, sink, env);
      if (result.success) {
        record.setup[setupFlagForStep(step)] = true;
        await this.store.upsert(record);
      } else {
        throw new Error(result.error ?? `Setup step "${step}" failed`);
      }
    }
    return this.requireRecord(slug);
  }

  /** The steps that still need running, in order. */
  async pendingSetup(slug: string): Promise<SetupStep[]> {
    const record = await this.requireRecord(slug);
    return FULL_SETUP_ORDER.filter(s => !record.setup[setupFlagForStep(s)]);
  }

  // ── Processes ─────────────────────────────────────────────────────────────

  async startProcess(
    slug: string,
    target: LaunchTarget,
    sink: EventSink = noopSink,
    source: 'gui' | 'cli' = 'cli'
  ): Promise<ManagedProcess> {
    const record = await this.requireRecord(slug);
    return this.procs.start(record, target, sink, this.instanceEnv(record, slug, sink), source);
  }

  /** Enumerate launchable targets (services + scripts) for an instance. */
  async listRunTargets(slug: string): Promise<RunOption[]> {
    return ProcessManager.listRunTargets(await this.requireRecord(slug));
  }

  /**
   * Child-process env for an instance's setup/build/serve commands, with the
   * instance's chosen Node version (default `'auto'` = highest installed nvm)
   * prepended to PATH so `node`/`npm`/`node-gyp` resolve to it.
   */
  private instanceEnv(record: InstanceRecord, slug: string, sink: EventSink): NodeJS.ProcessEnv {
    const resolved = resolveNodeForWorktree(record.worktreePath, record.node);
    if (resolved.version) {
      emit(sink, slug, 'node', 'info', `Using Node ${resolved.version} (${resolved.source})`);
    }
    return envWithNode(resolved.binDir);
  }

  stopProcess(id: string): Promise<void> {
    return this.procs.stop(id);
  }

  /** Restart a tracked process by re-launching its original target. */
  async restartProcess(id: string, sink: EventSink = noopSink): Promise<ManagedProcess> {
    const meta = (await this.procs.list()).find(p => p.id === id);
    if (!meta) throw new Error(`No tracked process "${id}"`);
    const record = await this.requireRecord(meta.slug);
    return this.procs.restart(id, record, sink, this.instanceEnv(record, meta.slug, sink));
  }

  /** Drop a process from the list (stops it first if still running). */
  removeProcess(id: string): Promise<void> {
    return this.procs.remove(id);
  }

  listProcesses(slug?: string): Promise<ManagedProcess[]> {
    return this.procs.list(slug);
  }

  processLogs(id: string): Promise<string[]> {
    return this.procs.getLogs(id);
  }

  /** Incrementally tail a process's output from a byte offset (for live streaming). */
  processLogsSince(id: string, sinceByte: number): Promise<{ lines: string[]; nextByte: number }> {
    return this.procs.getLogsSince(id, sinceByte);
  }

  async listScripts(slug: string): Promise<string[]> {
    const record = await this.requireRecord(slug);
    return ProcessManager.listScripts(record.worktreePath);
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  /** Resolve the worktree path to open in an editor. */
  async worktreePath(slug: string): Promise<string> {
    return (await this.requireRecord(slug)).worktreePath;
  }

  /**
   * Reconcile the instance's editor-navigation artifacts (per-app symlinks +
   * the multi-root `.code-workspace`) to match the current dev-linked set.
   * Best-effort — these are navigation conveniences and must never fail or
   * block an open-app operation. Called after every link/install/unlink/switch
   * and lazily on {@link prepareEditorTarget} so a drifted instance self-heals.
   */
  private async reconcileEditorArtifacts(slug: string, worktreePath: string): Promise<void> {
    try {
      const apps = await this.openApps.listApps(slug);
      const devApps = apps.filter(a => a.mode === 'dev').map(a => a.appName);
      reconcileInstanceEditorArtifacts(worktreePath, slug, devApps);
    } catch {
      /* navigation sugar — swallow so opening/linking never breaks */
    }
  }

  /**
   * Reconcile editor artifacts, then return what "Open in VS Code" should open:
   * the multi-root `.code-workspace` (per-app Source Control) if it exists, else
   * the plain worktree dir. Both CLI `open` and the GUI button call this.
   */
  async prepareEditorTarget(slug: string): Promise<string> {
    const record = await this.requireRecord(slug);
    await this.reconcileEditorArtifacts(slug, record.worktreePath);
    return resolveEditorTarget(record.worktreePath, slug);
  }

  /** Stop all tracked child processes (call on host shutdown). */
  dispose(): void {
    this.procs.disposeAll();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Remove the per-instance folder (`instancesRootDir/<slug>/`) after its MJ
   * worktree is gone, so the unified layout doesn't leave empty shells behind.
   * Only acts on the managed `<slug>/mj` shape and never escapes the workspace.
   */
  private async removeInstanceDir(worktreePath: string): Promise<void> {
    if (path.basename(worktreePath) !== 'mj') return;
    const slugDir = path.dirname(worktreePath);
    const rel = path.relative(this.paths.instancesRootDir, slugDir);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep))
      return;
    await fs.rm(slugDir, { recursive: true, force: true });
  }

  private async requireRecord(slug: string): Promise<InstanceRecord> {
    const record = await this.store.get(slug);
    if (!record) throw new Error(`No instance named "${slug}"`);
    return record;
  }

  private async uniqueSlug(name: string, existing: InstanceRecord[]): Promise<string> {
    const base = slugify(name);
    const taken = new Set(existing.map(i => i.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${base}-${newId().slice(0, 4)}`;
  }
}
