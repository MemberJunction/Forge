import { Injectable, computed, inject, signal } from '@angular/core';
import type { DevPersona } from '@mj-forge/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';

/**
 * Reactive state for MJ Dev Manager developer identities (Phase 2). Wraps the
 * persona roster and credential-minting IPC surface so the Instances UI can
 * show a global active persona, edit the roster, override the persona per
 * instance, open a logged-in Explorer, and copy a minted API key.
 */
@Injectable({ providedIn: 'root' })
export class IdentityStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);

  private readonly _personas = signal<DevPersona[]>([]);
  private readonly _activeId = signal<string | null>(null);
  private readonly _busy = signal(false);

  readonly personas = this._personas.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly activePersona = computed(
    () => this._personas().find(p => p.id === this._activeId()) ?? null
  );

  async refresh(): Promise<void> {
    if (!this.ipc.isAvailable) return;
    try {
      const [personas, active] = await Promise.all([
        this.ipc.identity.listPersonas(),
        this.ipc.identity.getActive(),
      ]);
      this._personas.set(personas);
      this._activeId.set(active?.id ?? null);
    } catch (err) {
      this.notification.error(`Failed to load personas: ${this.msg(err)}`);
    }
  }

  async savePersona(persona: DevPersona): Promise<DevPersona | null> {
    return this.guard(async () => {
      const saved = await this.ipc.identity.savePersona(persona);
      await this.refresh();
      this.notification.success(`Saved persona "${saved.name}"`);
      return saved;
    });
  }

  async deletePersona(id: string): Promise<void> {
    await this.guard(() => this.ipc.identity.deletePersona(id));
    await this.refresh();
  }

  async setActive(id: string): Promise<void> {
    await this.guard(() => this.ipc.identity.setActive(id));
    await this.refresh();
  }

  /** Set or clear (`personaId` = undefined) an instance's persona override. */
  async setInstancePersona(slug: string, personaId: string | undefined): Promise<void> {
    await this.guard(() => this.ipc.identity.setInstancePersona(slug, personaId));
  }

  /** Mint (or fetch) the persona's API key and copy it to the clipboard. */
  async copyApiKey(slug: string): Promise<void> {
    const result = await this.guard(() => this.ipc.identity.mintKey(slug));
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.rawKey);
      this.notification.success('API key copied to clipboard');
    } catch {
      this.notification.info(`API key: ${result.rawKey}`);
    }
  }

  /** Mint a magic-link session and open a logged-in Explorer in the browser. */
  async openExplorer(slug: string): Promise<void> {
    const result = await this.guard(() => this.ipc.identity.openExplorer(slug));
    if (result) this.notification.success('Opening Explorer (logged in)…');
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
