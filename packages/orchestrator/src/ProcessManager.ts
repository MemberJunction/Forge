import * as fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn } from 'node:child_process';
import type { InstanceRecord, ManagedProcess, RunOption } from '@mj-forge/shared';
import { emit, type EventSink, noopSink, newId } from './util.js';
import type { ResolvedPaths } from './paths.js';
import { ProcessStore, type ProcRecord } from './ProcessStore.js';

/** What to launch: a known service shortcut or an arbitrary package script. */
export type LaunchTarget = 'api' | 'explorer' | { script: string };

const LOG_TAIL = 500;
const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Spawns and tracks long-running service processes (MJAPI, MJExplorer, or any
 * package script) for instances. Unlike a naive in-memory tracker, this manager
 * is a **peer over a shared, file-backed registry** ({@link ProcessStore}):
 *
 *   - Processes are spawned **detached** (own process group) with stdout/stderr
 *     redirected to a per-process log file, and `unref()`'d — so they OUTLIVE the
 *     launcher (a short-lived `mjdev` CLI invocation, or the Electron app on quit).
 *   - Every launch is recorded in `~/.mjdev/processes.json`, so the CLI and GUI
 *     each see what the other started. {@link list} reconciles the registry with
 *     OS reality (pid liveness + a TCP probe) on every read.
 *
 * This is what lets an agent `mjdev run <slug> api`, exit, and have the GUI show
 * that MJAPI as running — and vice versa.
 */
export class ProcessManager {
  private readonly store: ProcessStore;

  constructor(private readonly paths: ResolvedPaths) {
    this.store = new ProcessStore(paths);
  }

  /** Discover runnable npm scripts from the worktree's root package.json. */
  static async listScripts(worktreePath: string): Promise<string[]> {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(worktreePath, 'package.json'), 'utf8'));
      return Object.keys(pkg.scripts ?? {}).filter(s => /start|serve|dev|watch/i.test(s));
    } catch {
      return [];
    }
  }

  /**
   * Enumerate everything an instance can launch: the built-in `api`/`explorer`
   * services plus discovered package scripts (de-duped against the built-ins).
   * This is what `mjdev runs` and the GUI Run picker show.
   */
  static async listRunTargets(record: InstanceRecord): Promise<RunOption[]> {
    const options: RunOption[] = [
      { name: 'api', label: 'MJAPI', kind: 'service', port: record.ports.api },
      { name: 'explorer', label: 'MJExplorer', kind: 'service', port: record.ports.explorer },
    ];
    const scripts = await ProcessManager.listScripts(record.worktreePath);
    for (const s of scripts) {
      // 'start:api' is what the api service runs; 'start' is the explorer's.
      if (s === 'start:api' || s === 'start') continue;
      options.push({ name: s, label: s, kind: 'script' });
    }
    return options;
  }

  /** Launch a service for an instance (detached) and record it in the registry. */
  async start(
    record: InstanceRecord,
    target: LaunchTarget,
    sink: EventSink = noopSink,
    env: NodeJS.ProcessEnv = process.env,
    source: 'gui' | 'cli' = 'cli'
  ): Promise<ManagedProcess> {
    const { cwd, args, label, port, script, targetToken } = this.resolveTarget(record, target);
    const op = `proc:${script}`;
    emit(sink, record.slug, op, 'progress', `Starting ${label}…`);

    // One live entry per (slug, target): drop any prior record for it first.
    const existing = (await this.store.list(record.slug)).filter(
      p => p.targetToken === targetToken
    );
    for (const e of existing) {
      if (await this.pidAlive(e.pid)) this.killTree(e.pgid ?? e.pid);
      await this.store.remove(e.id);
    }

    await fs.mkdir(this.paths.procLogsDir, { recursive: true });
    const id = newId();
    const logFile = path.join(this.paths.procLogsDir, `${record.slug}-${script}-${id}.log`);
    const fd = openSync(logFile, 'a');
    let child;
    try {
      child = spawn('npm', args, {
        cwd,
        env: { ...env },
        detached: true, // own process group → whole-tree kill, and survives the launcher
        stdio: ['ignore', fd, fd],
      });
      child.unref();
    } finally {
      closeSync(fd); // the child holds its own dup'd fd
    }

    const rec: ProcRecord = {
      id,
      slug: record.slug,
      label,
      script,
      port,
      pid: child.pid,
      pgid: child.pid, // detached: the child IS its group leader
      status: 'starting',
      startedAt: new Date().toISOString(),
      source,
      logFile,
      targetToken,
    };
    await this.store.upsert(rec);
    emit(
      sink,
      record.slug,
      op,
      'success',
      `Started ${label}${port ? ` on :${port}` : ''} (pid ${child.pid})`
    );
    return this.toManaged(rec);
  }

  /**
   * Restart a process by id: kill it (if alive) and relaunch its original target.
   * Returns the new process record.
   */
  async restart(
    id: string,
    record: InstanceRecord,
    sink: EventSink = noopSink,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<ManagedProcess> {
    const rec = await this.store.get(id);
    if (!rec) throw new Error(`No tracked process "${id}"`);
    if (await this.pidAlive(rec.pid)) {
      this.killTree(rec.pgid ?? rec.pid);
      await delay(600); // let the port free before rebinding
    }
    await this.store.remove(id);
    return this.start(record, this.tokenToTarget(rec.targetToken), sink, env, rec.source ?? 'cli');
  }

  /** Stop a process (kills its whole group), keeping it listed as stopped. */
  async stop(id: string): Promise<void> {
    const rec = await this.store.get(id);
    if (!rec) return;
    if (await this.pidAlive(rec.pid)) this.killTree(rec.pgid ?? rec.pid);
    await this.store.upsert({ ...rec, status: 'stopped' });
  }

  /** Stop and remove a process from the registry. */
  async remove(id: string): Promise<void> {
    const rec = await this.store.get(id);
    if (!rec) return;
    if (await this.pidAlive(rec.pid)) this.killTree(rec.pgid ?? rec.pid);
    await this.store.remove(id);
  }

  /** Stop every process for a given instance. */
  async stopForInstance(slug: string): Promise<void> {
    for (const rec of await this.store.list(slug)) await this.stop(rec.id);
  }

  /**
   * List processes, reconciling the registry against OS reality first: a dead
   * pid → `stopped`; a live pid whose port accepts connections → `running`; live
   * but not-yet-listening → `starting`; live with no port → `running`.
   */
  async list(slug?: string): Promise<ManagedProcess[]> {
    const all = await this.store.list();
    let changed = false;
    for (const rec of all) {
      const next = await this.reconcileStatus(rec);
      if (next !== rec.status) {
        rec.status = next;
        changed = true;
      }
    }
    if (changed) await this.store.replaceAll(all);
    return all.filter(r => !slug || r.slug === slug).map(r => this.toManaged(r));
  }

  /** Tail the detached log file for a process. */
  async getLogs(id: string): Promise<string[]> {
    const rec = await this.store.get(id);
    if (!rec?.logFile) return [];
    try {
      const text = await fs.readFile(rec.logFile, 'utf8');
      return text.split('\n').slice(-LOG_TAIL);
    } catch {
      return [];
    }
  }

  /**
   * Incrementally read a process's log file from a byte offset, returning only
   * the NEW complete lines plus the offset to resume from. This lets a poller
   * (the GUI activity monitor) stream detached-process output without re-reading
   * the whole file or duplicating lines:
   *   - `sinceByte < 0` seeds at end-of-file (no backlog dump on first watch).
   *   - `sinceByte` past EOF (file rotated/truncated) restarts from 0.
   *   - A trailing partial line (no newline yet) is left for the next read.
   */
  async getLogsSince(id: string, sinceByte = 0): Promise<{ lines: string[]; nextByte: number }> {
    const rec = await this.store.get(id);
    if (!rec?.logFile) return { lines: [], nextByte: 0 };
    let size: number;
    try {
      size = (await fs.stat(rec.logFile)).size;
    } catch {
      return { lines: [], nextByte: 0 };
    }
    if (sinceByte < 0) return { lines: [], nextByte: size }; // seek to end
    const start = sinceByte > size ? 0 : sinceByte; // rotated/truncated → restart
    if (start >= size) return { lines: [], nextByte: size };

    const fh = await fs.open(rec.logFile, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      const text = buf.toString('utf8');
      const lastNl = text.lastIndexOf('\n');
      if (lastNl === -1) return { lines: [], nextByte: start }; // no complete line yet
      const complete = text.slice(0, lastNl);
      return {
        lines: complete.split('\n'),
        nextByte: start + Buffer.byteLength(complete, 'utf8') + 1,
      };
    } finally {
      await fh.close();
    }
  }

  /**
   * No-op by design: processes are detached and recorded in the shared registry,
   * so they intentionally SURVIVE the launcher exiting (CLI invocation or GUI
   * quit). Lifecycle is managed explicitly via {@link stop}/{@link remove} or the
   * GUI/CLI. Kept so the host quit handler can call it without special-casing.
   */
  disposeAll(): void {
    /* intentionally does not kill — see doc comment */
  }

  private async reconcileStatus(rec: ProcRecord): Promise<ProcRecord['status']> {
    if (!(await this.pidAlive(rec.pid))) return 'stopped';
    if (rec.port) return (await this.isPortListening(rec.port)) ? 'running' : 'starting';
    return 'running';
  }

  private async pidAlive(pid?: number): Promise<boolean> {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM means the process exists but we can't signal it → still alive.
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  private async isPortListening(port: number, timeoutMs = 400): Promise<boolean> {
    // Probe BOTH loopback families: Node http servers usually bind dual-stack,
    // but Angular/Vite dev servers bind `localhost` → IPv6 `::1` on macOS, so an
    // IPv4-only probe would wrongly report the service as still starting.
    const tryHost = (host: string): Promise<boolean> =>
      new Promise(resolve => {
        const socket = new net.Socket();
        const done = (ok: boolean) => {
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
        socket.connect(port, host);
      });
    const results = await Promise.all([tryHost('127.0.0.1'), tryHost('::1')]);
    return results.some(Boolean);
  }

  private killTree(pid?: number): void {
    if (pid === undefined) return;
    try {
      process.kill(-pid, 'SIGTERM'); // negative pid → whole process group
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }

  private toManaged(rec: ProcRecord): ManagedProcess {
    // Strip registry-only fields (pgid, targetToken) from the public shape.
    const { targetToken: _t, pgid: _g, ...managed } = rec;
    void _t;
    void _g;
    return managed;
  }

  private tokenToTarget(token: string): LaunchTarget {
    if (token === 'api' || token === 'explorer') return token;
    return { script: token };
  }

  private resolveTarget(
    record: InstanceRecord,
    target: LaunchTarget
  ): {
    cwd: string;
    args: string[];
    label: string;
    port?: number;
    script: string;
    targetToken: string;
  } {
    if (target === 'api') {
      return {
        cwd: record.worktreePath,
        args: ['run', 'start:api'],
        label: 'MJAPI',
        port: record.ports.api,
        script: 'start:api',
        targetToken: 'api',
      };
    }
    if (target === 'explorer') {
      // Override the script's hardcoded --port 4201 (ng: last flag wins).
      return {
        cwd: path.join(record.worktreePath, 'packages', 'MJExplorer'),
        args: ['run', 'start', '--', '--port', String(record.ports.explorer)],
        label: 'MJExplorer',
        port: record.ports.explorer,
        script: 'start',
        targetToken: 'explorer',
      };
    }
    return {
      cwd: record.worktreePath,
      args: ['run', target.script],
      label: target.script,
      script: target.script,
      targetToken: target.script,
    };
  }
}
