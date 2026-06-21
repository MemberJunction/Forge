/**
 * MJ Dev Manager — developer identity / persona IPC handlers (Phase 2).
 *
 * Bridges the renderer to the shared @mj-forge/orchestrator engine for the
 * persona roster and credential minting. Magic-link Explorer sessions are
 * opened in the user's browser via `shell.openExternal`.
 */

import { BrowserWindow, shell } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type { DevPersona, InstanceEvent } from '@mj-forge/shared';
import { InstanceOrchestrator } from '@mj-forge/orchestrator';
import { safeHandle } from './safe-handle';
import { getOrchestrator } from './instances.ipc';

/** Broadcast an orchestration event to every renderer window. */
function broadcast(event: InstanceEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.INSTANCES.EVENTS, event);
  }
}

export function registerIdentityHandlers(): void {
  const engine: InstanceOrchestrator = getOrchestrator();
  const sink = broadcast;

  safeHandle(IPC_CHANNELS.IDENTITY.PERSONA_LIST, async () => engine.listPersonas());

  safeHandle(IPC_CHANNELS.IDENTITY.PERSONA_SAVE, async (_e, persona: DevPersona) =>
    engine.savePersona(persona)
  );

  safeHandle(IPC_CHANNELS.IDENTITY.PERSONA_DELETE, async (_e, id: string) => {
    await engine.removePersona(id);
    return { success: true };
  });

  safeHandle(IPC_CHANNELS.IDENTITY.ACTIVE_GET, async () => engine.getActivePersona());

  safeHandle(IPC_CHANNELS.IDENTITY.ACTIVE_SET, async (_e, id: string) => {
    await engine.setActivePersona(id);
    return { success: true };
  });

  safeHandle(
    IPC_CHANNELS.IDENTITY.INSTANCE_PERSONA_SET,
    async (_e, slug: string, personaId: string | undefined) =>
      engine.setInstancePersona(slug, personaId)
  );

  safeHandle(IPC_CHANNELS.IDENTITY.WHOAMI, async (_e, slug: string) => engine.whoami(slug));

  safeHandle(IPC_CHANNELS.IDENTITY.MINT_KEY, async (_e, slug: string, force?: boolean) => {
    const rawKey = await engine.mintApiKey(slug, sink, force ?? false);
    return { rawKey };
  });

  safeHandle(IPC_CHANNELS.IDENTITY.OPEN_EXPLORER, async (_e, slug: string) => {
    const url = await engine.openExplorerAs(slug, sink);
    await shell.openExternal(url);
    return { success: true, url };
  });

  safeHandle(IPC_CHANNELS.IDENTITY.APP_ACCESS_LIST, async (_e, slug: string) =>
    engine.listAppAccess(slug)
  );

  safeHandle(
    IPC_CHANNELS.IDENTITY.APP_ACCESS_SET,
    async (_e, slug: string, appName: string, granted: boolean) =>
      engine.setAppAccess(slug, appName, granted, sink)
  );
}
