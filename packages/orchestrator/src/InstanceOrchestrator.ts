import * as path from 'node:path';
import type {
  InstanceConfig,
  InstanceRecord,
  InstanceSecrets,
  ManagedProcess,
  SetupStep,
} from '@mj-forge/shared';
import { resolvePaths, type OrchestratorOptions, type ResolvedPaths } from './paths.js';
import { InstanceStore } from './InstanceStore.js';
import { PortAllocator } from './PortAllocator.js';
import { DockerManager } from './DockerManager.js';
import { WorktreeManager } from './WorktreeManager.js';
import { ConfigWriter } from './ConfigWriter.js';
import { SetupRunner, FULL_SETUP_ORDER, setupFlagForStep } from './SetupRunner.js';
import { ProcessManager, type LaunchTarget } from './ProcessManager.js';
import { buildSetupScript } from './dbBootstrap.js';
import { resolveNodeForWorktree, envWithNode } from './nodeEnv.js';
import {
  emit,
  type EventSink,
  noopSink,
  slugify,
  newId,
  generatePassword,
  generateEncryptionKey,
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
  private readonly docker: DockerManager;
  private readonly worktrees: WorktreeManager;
  private readonly config: ConfigWriter;
  private readonly setup: SetupRunner;
  private readonly procs: ProcessManager;

  constructor(options: OrchestratorOptions = {}, docker?: DockerManager) {
    this.paths = resolvePaths(options);
    this.store = new InstanceStore(this.paths);
    this.docker = docker ?? new DockerManager();
    this.worktrees = new WorktreeManager(this.paths.mjRepoPath);
    this.config = new ConfigWriter();
    this.setup = new SetupRunner();
    this.procs = new ProcessManager();
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
    return { record, containerState, processes: this.procs.list(slug), nodeVersion };
  }

  // ── Create (provision-only) with rollback saga ────────────────────────────

  async create(config: InstanceConfig, sink: EventSink = noopSink): Promise<CreateResult> {
    const existing = await this.store.list();
    const slug = await this.uniqueSlug(config.name, existing);
    emit(sink, slug, 'create', 'progress', `Provisioning instance "${config.name}"…`);

    await this.docker.assertAvailable();
    await this.worktrees.assertRepo();

    // Reserve ports already published by any Docker container (e.g. the dev's
    // own SQL Server on 1433) so we never collide with them.
    const reserved = await this.docker.listPublishedHostPorts().catch(() => []);
    const ports = await PortAllocator.allocate(
      existing.map(i => i.ports),
      config.ports,
      reserved
    );
    const branch = config.branch?.trim() || `mjdev/${slug}`;
    const baseRef = config.baseRef?.trim() || 'HEAD';
    const dbName = config.database?.name?.trim() || `MJ_${slug.replace(/-/g, '_')}`;
    const worktreePath = path.join(this.paths.worktreesDir, slug);
    const secretsRef = slug;

    const saPassword =
      config.database?.saPassword && config.database.saPassword !== 'auto'
        ? config.database.saPassword
        : generatePassword();
    // Distinct least-privilege app logins — never `sa` (see dbBootstrap.ts).
    // `sa` is retained only to bootstrap the container.
    const secrets: InstanceSecrets = {
      saPassword,
      dbUsername: 'MJ_Connect',
      dbPassword: generatePassword(),
      codegenUsername: 'MJ_CodeGen',
      codegenPassword: generatePassword(),
      encryptionKey: generateEncryptionKey(),
    };

    const record: InstanceRecord = {
      id: newId(),
      slug,
      name: config.name,
      branch,
      worktreePath,
      container: { name: `mjdev-${slug}`, volume: `mjdev-${slug}-data` },
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
      // 1) Docker SQL container
      const containerId = await this.docker.createSqlContainer(record, saPassword, sink);
      record.container.id = containerId;
      rollback.push(() => this.docker.remove(record.container.name, record.container.volume));
      await this.docker.waitHealthy(record, saPassword, sink);

      // 1b) Database, least-privilege logins, users, and role grants (idempotent)
      emit(sink, slug, 'create', 'progress', 'Creating database, logins, and roles…');
      await this.docker.execSql(
        record.container.name,
        saPassword,
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

      // 2) Git worktree
      await this.worktrees.add(worktreePath, branch, baseRef, slug, sink);
      rollback.push(() => this.worktrees.remove(worktreePath, slug));

      // 3) Config files
      const written = await this.config.write(worktreePath, record, secrets);
      record.setup.configWritten = true;
      emit(sink, slug, 'create', 'info', `Wrote ${written.length} config file(s)`);

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
    emit(sink, slug, 'start', 'progress', 'Starting SQL container…');
    await this.docker.start(record.container.name);
    const secrets = await this.store.getSecrets(record.secretsRef);
    if (secrets) await this.docker.waitHealthy(record, secrets.saPassword, sink);
    record.status = 'running';
    await this.store.upsert(record);
    emit(sink, slug, 'start', 'success', 'Instance started');
    return record;
  }

  async stop(slug: string, sink: EventSink = noopSink): Promise<InstanceRecord> {
    const record = await this.requireRecord(slug);
    emit(sink, slug, 'stop', 'progress', 'Stopping services and container…');
    await this.procs.stopForInstance(slug);
    await this.docker.stop(record.container.name).catch(() => {});
    record.status = 'stopped';
    await this.store.upsert(record);
    emit(sink, slug, 'stop', 'success', 'Instance stopped');
    return record;
  }

  async delete(slug: string, sink: EventSink = noopSink): Promise<void> {
    const record = await this.requireRecord(slug);
    emit(sink, slug, 'delete', 'progress', 'Deleting instance…');
    await this.procs.stopForInstance(slug);
    await this.docker.remove(record.container.name, record.container.volume).catch(() => {});
    await this.worktrees.remove(record.worktreePath, slug, sink).catch(() => {});
    await this.store.remove(slug);
    await this.store.deleteConfig(slug);
    await this.store.deleteSecrets(record.secretsRef);
    emit(sink, slug, 'delete', 'success', 'Instance deleted');
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
    sink: EventSink = noopSink
  ): Promise<ManagedProcess> {
    const record = await this.requireRecord(slug);
    return this.procs.start(record, target, sink, this.instanceEnv(record, slug, sink));
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

  listProcesses(slug?: string): ManagedProcess[] {
    return this.procs.list(slug);
  }

  processLogs(id: string): string[] {
    return this.procs.getLogs(id);
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

  /** Stop all tracked child processes (call on host shutdown). */
  dispose(): void {
    this.procs.disposeAll();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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
