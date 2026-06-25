import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  InstanceConfig,
  InstanceEvent,
  InstanceRecord,
  ManagedProcess,
  SetupStep,
} from '@mj-forge/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';

/**
 * Reactive state for the MJ Dev Manager "Instances" feature. Wraps the shared
 * orchestration engine exposed over IPC and fans its streamed progress events
 * into a per-instance log the UI can tail.
 */
@Injectable({ providedIn: 'root' })
export class InstancesStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);

  private readonly _instances = signal<InstanceRecord[]>([]);
  private readonly _selectedSlug = signal<string | null>(null);
  private readonly _busy = signal(false);
  private readonly _processes = signal<ManagedProcess[]>([]);
  private readonly _scripts = signal<string[]>([]);
  private readonly _log = signal<InstanceEvent[]>([]);

  readonly instances = this._instances.asReadonly();
  readonly selectedSlug = this._selectedSlug.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly processes = this._processes.asReadonly();
  readonly scripts = this._scripts.asReadonly();
  readonly log = this._log.asReadonly();

  readonly selected = computed(
    () => this._instances().find(i => i.slug === this._selectedSlug()) ?? null
  );
  readonly runningCount = computed(
    () => this._instances().filter(i => i.status === 'running').length
  );
  /** Setup steps still pending for the selected instance, in order. */
  readonly pendingSetup = computed<SetupStep[]>(() => {
    const s = this.selected();
    if (!s) return [];
    // Provisioning order only — codegen is on-demand, not part of `setup all`.
    const order: SetupStep[] = ['deps', 'build', 'migrate'];
    const flag: Record<SetupStep, boolean> = {
      deps: s.setup.depsInstalled,
      build: s.setup.built,
      migrate: s.setup.migrated,
      codegen: s.setup.codegen,
    };
    return order.filter(step => !flag[step]);
  });

  private unsubscribe?: () => void;
  private pollTimer?: ReturnType<typeof setInterval>;
  /** How often to reconcile the process list against the shared registry. */
  private static readonly PROC_POLL_MS = 4000;

  /** Begin listening for engine events (call once from the panel on init). */
  startListening(): void {
    if (this.unsubscribe || !this.ipc.isAvailable) return;
    this.unsubscribe = this.ipc.instances.onEvent(event => {
      this._log.update(l => [...l.slice(-300), event]);
      // Refresh records when an operation reaches a terminal state.
      if (event.level === 'success' || event.level === 'error') {
        if (/^(create|start|stop|delete|setup)/.test(event.op)) void this.refresh();
        if (event.op.startsWith('proc')) void this.refreshProcesses();
      }
    });
    // Processes can be started/stopped from the CLI (a separate OS process), so
    // there's no IPC event to react to — poll the shared registry to stay in sync.
    this.pollTimer = setInterval(() => {
      if (this._selectedSlug()) void this.refreshProcesses();
    }, InstancesStateService.PROC_POLL_MS);
  }

  stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  clearLog(): void {
    this._log.set([]);
  }

  async refresh(): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      this._instances.set(await this.ipc.instances.list());
    } catch (err) {
      this.notification.error(`Failed to load instances: ${this.msg(err)}`);
    }
  }

  select(slug: string | null): void {
    this._selectedSlug.set(slug);
    if (slug) void this.refreshProcesses();
  }

  async create(config: InstanceConfig): Promise<InstanceRecord | null> {
    return this.guard(async () => {
      const record = await this.ipc.instances.create(config);
      await this.refresh();
      this._selectedSlug.set(record.slug);
      this.notification.success(`Instance "${record.slug}" provisioned`);
      return record;
    });
  }

  async start(slug: string): Promise<void> {
    await this.guard(() => this.ipc.instances.start(slug));
    await this.refresh();
  }

  async stop(slug: string): Promise<void> {
    await this.guard(() => this.ipc.instances.stop(slug));
    await this.refresh();
  }

  /** Pull the instance branch from its remote upstream (ff-only). */
  async pull(slug: string): Promise<void> {
    const r = await this.guard(() => this.ipc.instances.pull(slug));
    if (r) this.notification.info(r.message);
  }

  /** Merge the instance's base branch in (pick up base-branch commits). */
  async mergeFromBase(slug: string): Promise<void> {
    const r = await this.guard(() => this.ipc.instances.mergeFromBase(slug));
    if (r)
      (r.updated ? this.notification.success : this.notification.info).call(
        this.notification,
        r.message
      );
  }

  async delete(slug: string): Promise<void> {
    await this.guard(() => this.ipc.instances.delete(slug));
    if (this._selectedSlug() === slug) this._selectedSlug.set(null);
    await this.refresh();
  }

  async runSetup(slug: string, step: SetupStep | 'all'): Promise<void> {
    await this.guard(() => this.ipc.instances.runSetup(slug, step));
    await this.refresh();
  }

  async openInVSCode(slug: string): Promise<void> {
    try {
      await this.ipc.instances.openInVSCode(slug);
    } catch (err) {
      this.notification.error(`Could not open VS Code: ${this.msg(err)}`);
    }
  }

  async startProcess(slug: string, target: 'api' | 'explorer' | { script: string }): Promise<void> {
    try {
      await this.ipc.instances.startProcess(slug, target);
      await this.refreshProcesses();
    } catch (err) {
      this.notification.error(`Failed to start process: ${this.msg(err)}`);
    }
  }

  async stopProcess(processId: string): Promise<void> {
    await this.ipc.instances.stopProcess(processId).catch(() => {});
    await this.refreshProcesses();
  }

  async restartProcess(processId: string): Promise<void> {
    try {
      await this.ipc.instances.restartProcess(processId);
    } catch (err) {
      this.notification.error(`Failed to restart process: ${this.msg(err)}`);
    }
    await this.refreshProcesses();
  }

  async removeProcess(processId: string): Promise<void> {
    await this.ipc.instances.removeProcess(processId).catch(() => {});
    await this.refreshProcesses();
  }

  /** Byte offset already ingested per process id, so we only stream NEW output. */
  private readonly logOffsets = new Map<string, number>();

  async refreshProcesses(): Promise<void> {
    const slug = this._selectedSlug();
    if (!slug || !this.ipc.isAvailable) {
      this._processes.set([]);
      this._scripts.set([]);
      return;
    }
    try {
      const { processes, scripts } = await this.ipc.instances.listProcesses(slug);
      this._processes.set(processes);
      this._scripts.set(scripts);
      await this.tailProcessLogs(processes);
    } catch {
      /* non-fatal */
    }
  }

  /**
   * Stream each process's captured stdout/stderr into the activity monitor by
   * incrementally tailing its log file. First sight of a process seeks to the end
   * (no backlog dump); subsequent polls append only the new complete lines as
   * `info` events. Works uniformly for GUI- and CLI/agent-started processes since
   * both write to the same per-process log files.
   */
  private async tailProcessLogs(processes: ManagedProcess[]): Promise<void> {
    const liveIds = new Set(processes.map(p => p.id));
    for (const id of this.logOffsets.keys()) {
      if (!liveIds.has(id)) this.logOffsets.delete(id);
    }
    for (const p of processes) {
      if (!p.id) continue;
      try {
        const first = !this.logOffsets.has(p.id);
        // First sight: read from the top and show the recent tail for immediate
        // context; afterwards stream only new lines from the saved offset.
        const since = first ? 0 : this.logOffsets.get(p.id)!;
        const { lines, nextByte } = await this.ipc.instances.processLogsSince(p.id, since);
        this.logOffsets.set(p.id, nextByte);
        const fresh = first ? lines.slice(-50) : lines.slice(-100);
        if (fresh.length) {
          const at = new Date().toISOString();
          const events: InstanceEvent[] = fresh.map(message => ({
            slug: p.slug,
            op: `proc:${p.script}`,
            level: 'info',
            message,
            at,
          }));
          this._log.update(l => [...l.slice(-300), ...events]);
        }
      } catch {
        /* non-fatal — a missing/locked log file just yields no new lines */
      }
    }
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T | null> {
    this._busy.set(true);
    try {
      return await fn();
    } catch (err) {
      this.notification.error(this.msg(err));
      return null;
    } finally {
      this._busy.set(false);
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
