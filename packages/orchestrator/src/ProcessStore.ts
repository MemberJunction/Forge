import * as fs from 'node:fs/promises';
import type { ManagedProcess } from '@mj-forge/shared';
import type { ResolvedPaths } from './paths.js';

/**
 * On-disk registry row for a launched process. Superset of {@link ManagedProcess}
 * with the bits the engine needs to manage a process it may not have spawned
 * itself: the OS process-group id (for whole-tree kill) and the launch token
 * (so any peer can restart it in place).
 */
export interface ProcRecord extends ManagedProcess {
  /** Process-group id (== pid for our detached spawns); kill via `-pgid`. */
  pgid?: number;
  /** The token passed to `run`/PROC_START: `api`, `explorer`, or a script name. */
  targetToken: string;
}

interface ProcessesFile {
  version: 1;
  processes: ProcRecord[];
}

/**
 * Shared, file-backed registry of running processes (`~/.mjdev/processes.json`),
 * the single source of truth both the CLI and the GUI read and write. Because a
 * CLI invocation and the Electron main process are separate OS processes that
 * can't share an in-memory map, every launched service is recorded here so each
 * peer sees what the other started. Writes are atomic (temp-file + rename) like
 * {@link InstanceStore}, so concurrent CLI/GUI writes can't corrupt the file.
 */
export class ProcessStore {
  constructor(private readonly paths: ResolvedPaths) {}

  async list(slug?: string): Promise<ProcRecord[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.paths.processesFile, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    // Best-effort cache: a corrupt file degrades to empty (the next write
    // rewrites it cleanly) rather than breaking every `ps`/process list.
    let all: ProcRecord[];
    try {
      all = (JSON.parse(raw) as ProcessesFile).processes ?? [];
    } catch {
      all = [];
    }
    return slug ? all.filter(p => p.slug === slug) : all;
  }

  async get(id: string): Promise<ProcRecord | undefined> {
    return (await this.list()).find(p => p.id === id);
  }

  /** Insert or replace a row (matched by id) and persist the full list. */
  async upsert(rec: ProcRecord): Promise<void> {
    const all = await this.list();
    const idx = all.findIndex(p => p.id === rec.id);
    if (idx >= 0) all[idx] = rec;
    else all.push(rec);
    await this.write(all);
  }

  /** Replace the entire list (used by reconciliation to prune/restate in one write). */
  async replaceAll(processes: ProcRecord[]): Promise<void> {
    await this.write(processes);
  }

  async remove(id: string): Promise<void> {
    const all = await this.list();
    const next = all.filter(p => p.id !== id);
    if (next.length !== all.length) await this.write(next);
  }

  private async write(processes: ProcRecord[]): Promise<void> {
    await fs.mkdir(this.paths.configDir, { recursive: true });
    const file: ProcessesFile = { version: 1, processes };
    const tmp = `${this.paths.processesFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2));
    await fs.rename(tmp, this.paths.processesFile);
  }
}
