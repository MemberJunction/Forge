import { Injectable, computed, inject, signal } from '@angular/core';
import type { InstanceEvent } from '@mj-forge/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';

/** A single dev-linked Open App, as reported by `openApps.list`. */
export interface LinkedApp {
  appName: string;
  mode: string;
  appRef: string;
  ignoreVersionRangeUsed: boolean;
  linkedBranch?: string;
}

/** Options accepted when dev-linking an app. */
export interface LinkAppOptions {
  ignoreVersionRange?: boolean;
  appBranch?: string;
  baseRef?: string;
}

/** Ops emitted on the instances event channel that this feature cares about. */
const APP_EVENT_OPS = /^app-(link|unlink|switch|engine)/;

/**
 * Reactive state for MJ Dev Manager "Open Apps" (Phase B). Wraps the
 * `window.forge.openApps.*` IPC surface so the instance detail view can
 * dev-link apps, toggle a linked app between dev/installed, run drift/repair/
 * reset operations, and tail a live progress strip of `app-*` engine events.
 *
 * Keyed by the slug currently being inspected: the linked-app list and progress
 * strip belong to one instance at a time, mirroring how IdentityStateService
 * scopes its app-access panel.
 */
@Injectable({ providedIn: 'root' })
export class OpenAppsStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);

  /** Linked apps for the currently inspected instance (keyed by slug). */
  private readonly _linkedApps = signal<{ slug: string; apps: LinkedApp[] } | null>(null);
  private readonly _busy = signal(false);
  private readonly _lastError = signal<string | null>(null);
  /** Live progress strip of recent `app-*` engine events for the active slug. */
  private readonly _progress = signal<InstanceEvent[]>([]);

  readonly linkedApps = this._linkedApps.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly progress = this._progress.asReadonly();

  /** The slug whose linked apps are currently loaded, or null. */
  readonly activeSlug = computed(() => this._linkedApps()?.slug ?? null);

  private unsubscribe?: () => void;
  /** How many progress lines to retain in the strip. */
  private static readonly PROGRESS_LIMIT = 80;

  /** Begin listening for engine events (call once from the panel on init). */
  startListening(): void {
    if (this.unsubscribe || !this.ipc.isAvailable) return;
    this.unsubscribe = this.ipc.instances.onEvent(event => {
      if (!APP_EVENT_OPS.test(event.op)) return;
      // Only surface events for the instance currently being inspected.
      if (this.activeSlug() && event.slug !== this.activeSlug()) return;
      this._progress.update(p => [...p.slice(-OpenAppsStateService.PROGRESS_LIMIT), event]);
      // Refresh the linked-app list when a mutating op reaches a terminal state.
      if (event.level === 'success' || event.level === 'error') {
        if (/^app-(link|unlink|switch)/.test(event.op) && event.slug === this.activeSlug()) {
          void this.refresh(event.slug);
        }
      }
    });
  }

  stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  clearProgress(): void {
    this._progress.set([]);
  }

  /** Load (or reload) the dev-linked apps for an instance. */
  async refresh(slug: string): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      const apps = await this.ipc.openApps.list(slug);
      this._linkedApps.set({ slug, apps });
    } catch (err) {
      this.notification.error(`Failed to load open apps: ${this.msg(err)}`);
    }
  }

  /** Forget the loaded linked-app list and clear the progress strip. */
  clear(): void {
    this._linkedApps.set(null);
    this._progress.set([]);
  }

  /** Dev-link an app by GitHub URL or local path. */
  async link(slug: string, appRef: string, opts?: LinkAppOptions): Promise<void> {
    const result = await this.guard(() => this.ipc.openApps.link(slug, appRef, opts));
    if (result) {
      await this.refresh(slug);
      this.notification.success(`Linked "${result.appName}" for development`);
    }
  }

  /** Unlink a dev-linked app, optionally dropping its schema/data. */
  async unlink(slug: string, appName: string, dropSchema: boolean): Promise<void> {
    const result = await this.guard(() => this.ipc.openApps.unlink(slug, appName, { dropSchema }));
    if (result) {
      await this.refresh(slug);
      this.notification.success(`Unlinked "${appName}"`);
    }
  }

  /** Toggle an app between dev and installed mode. */
  async switchMode(slug: string, appName: string, target: 'dev' | 'installed'): Promise<void> {
    const result = await this.guard(() => this.ipc.openApps.switchMode(slug, appName, target));
    if (result) {
      await this.refresh(slug);
      this.notification.success(`"${appName}" switched to ${target}`);
    }
  }

  /** Validate an app's schema against its migrations and surface the result. */
  async drift(slug: string, appName: string): Promise<void> {
    const result = await this.guard(() => this.ipc.openApps.drift(slug, appName));
    if (!result) return;
    if (result.valid) {
      this.notification.success(`"${appName}" schema is in sync (no drift)`);
    } else {
      this.notification.error(
        `"${appName}" drift detected: ${result.errors.join('; ') || 'see activity log'}`
      );
    }
  }

  /** Drop and re-create an app's schema from its migrations (destructive). */
  async resetSchema(slug: string, appName: string): Promise<void> {
    const result = await this.guard(() => this.ipc.openApps.resetSchema(slug, appName));
    if (result) this.notification.success(`Reset schema for "${appName}"`);
  }

  /** Re-stamp / repair an app's migration tracking without re-running SQL. */
  async repairSchema(slug: string, appName: string): Promise<void> {
    const result = await this.guard(() => this.ipc.openApps.repairSchema(slug, appName));
    if (result) this.notification.success(`Repaired schema tracking for "${appName}"`);
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T | null> {
    this._busy.set(true);
    this._lastError.set(null);
    try {
      return await fn();
    } catch (err) {
      const message = this.msg(err);
      this._lastError.set(message);
      this.notification.error(message);
      return null;
    } finally {
      this._busy.set(false);
    }
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
