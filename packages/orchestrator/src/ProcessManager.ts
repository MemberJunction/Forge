import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { InstanceRecord, ManagedProcess } from '@mj-forge/shared';
import { emit, type EventSink, noopSink, newId } from './util.js';

const LOG_RING = 500;

interface Tracked {
  meta: ManagedProcess;
  child: ChildProcess;
  logs: string[];
}

/** What to launch: a known service shortcut or an arbitrary package script. */
export type LaunchTarget = 'api' | 'explorer' | { script: string };

/**
 * Spawns and tracks long-running service processes for instances (MJAPI,
 * MJExplorer, or any package start script). Holds a per-process log ring buffer.
 * Processes are children of the host (Electron main or CLI) and are reaped on
 * shutdown via {@link disposeAll}.
 */
export class ProcessManager {
  private readonly tracked = new Map<string, Tracked>();

  /** Discover runnable npm scripts from the worktree's root package.json. */
  static async listScripts(worktreePath: string): Promise<string[]> {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(worktreePath, 'package.json'), 'utf8'));
      return Object.keys(pkg.scripts ?? {}).filter(s => /start|serve|dev|watch/i.test(s));
    } catch {
      return [];
    }
  }

  /** Launch a service for an instance and begin tracking it. */
  start(
    record: InstanceRecord,
    target: LaunchTarget,
    sink: EventSink = noopSink,
    env: NodeJS.ProcessEnv = process.env
  ): ManagedProcess {
    const { cwd, args, label, port, script } = this.resolveTarget(record, target);
    const id = newId();
    const op = `proc:${script}`;
    emit(sink, record.slug, op, 'progress', `Starting ${label}…`);

    const child = spawn('npm', args, {
      cwd,
      env: { ...env },
      detached: true, // own process group so we can kill the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const meta: ManagedProcess = {
      id,
      slug: record.slug,
      label,
      script,
      port,
      pid: child.pid,
      status: 'starting',
      startedAt: new Date().toISOString(),
    };
    const entry: Tracked = { meta, child, logs: [] };
    this.tracked.set(id, entry);

    const pushLog = (s: string) => {
      entry.logs.push(s);
      if (entry.logs.length > LOG_RING) entry.logs.shift();
      emit(sink, record.slug, op, 'info', s.trimEnd());
    };
    child.stdout?.on('data', (d: Buffer) => {
      if (meta.status === 'starting') meta.status = 'running';
      pushLog(d.toString());
    });
    child.stderr?.on('data', (d: Buffer) => pushLog(d.toString()));
    child.on('error', err => {
      meta.status = 'error';
      emit(sink, record.slug, op, 'error', `${label} failed to start: ${err.message}`);
    });
    child.on('exit', code => {
      meta.status = code === 0 || code === null ? 'stopped' : 'error';
      emit(sink, record.slug, op, code ? 'error' : 'info', `${label} exited (${code ?? 'signal'})`);
    });

    return { ...meta };
  }

  /** Stop a tracked process (kills its whole process group). */
  async stop(id: string): Promise<void> {
    const entry = this.tracked.get(id);
    if (!entry) return;
    this.killTree(entry.child);
    entry.meta.status = 'stopped';
  }

  /** Stop every process for a given instance. */
  async stopForInstance(slug: string): Promise<void> {
    for (const [id, entry] of this.tracked) {
      if (entry.meta.slug === slug) await this.stop(id);
    }
  }

  list(slug?: string): ManagedProcess[] {
    return [...this.tracked.values()]
      .filter(e => !slug || e.meta.slug === slug)
      .map(e => ({ ...e.meta }));
  }

  getLogs(id: string): string[] {
    return this.tracked.get(id)?.logs ?? [];
  }

  /** Kill all tracked processes — call on host shutdown. */
  disposeAll(): void {
    for (const entry of this.tracked.values()) this.killTree(entry.child);
    this.tracked.clear();
  }

  private killTree(child: ChildProcess): void {
    if (child.pid === undefined) return;
    try {
      // Negative pid targets the whole process group (spawned detached).
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }

  private resolveTarget(
    record: InstanceRecord,
    target: LaunchTarget
  ): { cwd: string; args: string[]; label: string; port?: number; script: string } {
    if (target === 'api') {
      return {
        cwd: record.worktreePath,
        args: ['run', 'start:api'],
        label: 'MJAPI',
        port: record.ports.api,
        script: 'start:api',
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
      };
    }
    return {
      cwd: record.worktreePath,
      args: ['run', target.script],
      label: target.script,
      script: target.script,
    };
  }
}
