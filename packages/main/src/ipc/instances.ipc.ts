/**
 * MJ Dev Manager — instance orchestration IPC handlers.
 *
 * Bridges the renderer to the shared @mj-forge/orchestrator engine (the same
 * engine the `mjdev` CLI uses). Progress/log events are broadcast to all
 * renderer windows over the EVENTS channel.
 */

import { BrowserWindow, shell } from 'electron';
import { spawn } from 'node:child_process';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type { InstanceConfig, InstanceEvent, SetupStep } from '@mj-forge/shared';
import { InstanceOrchestrator, type LaunchTarget } from '@mj-forge/orchestrator';
import { safeHandle } from './safe-handle';

let orchestrator: InstanceOrchestrator | undefined;

/** Broadcast an orchestration event to every renderer window. */
function broadcast(event: InstanceEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.INSTANCES.EVENTS, event);
  }
}

/** Lazily create the shared orchestrator singleton (shared with identity.ipc). */
export function getOrchestrator(): InstanceOrchestrator {
  if (!orchestrator) orchestrator = new InstanceOrchestrator();
  return orchestrator;
}

/** Kill any tracked child processes when the app is quitting. */
export function disposeInstances(): void {
  orchestrator?.dispose();
}

export function registerInstanceHandlers(): void {
  const engine = getOrchestrator();
  const sink = broadcast;

  safeHandle(IPC_CHANNELS.INSTANCES.CREATE, async (_e, config: InstanceConfig) => {
    const { record } = await engine.create(config, sink);
    return record;
  });

  safeHandle(IPC_CHANNELS.INSTANCES.LIST, async () => engine.list());

  safeHandle(IPC_CHANNELS.INSTANCES.INFO, async (_e, slug: string) => engine.info(slug));

  safeHandle(IPC_CHANNELS.INSTANCES.START, async (_e, slug: string) => engine.start(slug, sink));

  safeHandle(IPC_CHANNELS.INSTANCES.STOP, async (_e, slug: string) => engine.stop(slug, sink));

  safeHandle(IPC_CHANNELS.INSTANCES.DELETE, async (_e, slug: string) => {
    await engine.delete(slug, sink);
    return { success: true };
  });

  safeHandle(IPC_CHANNELS.INSTANCES.OPEN_VSCODE, async (_e, slug: string) => {
    const dir = await engine.worktreePath(slug);
    // Prefer the `code` CLI; fall back to the OS file handler if it's absent.
    try {
      const child = spawn('code', [dir], { detached: true, stdio: 'ignore' });
      child.on('error', () => void shell.openPath(dir));
      child.unref();
    } catch {
      await shell.openPath(dir);
    }
    return { success: true, path: dir };
  });

  safeHandle(IPC_CHANNELS.INSTANCES.SETUP_RUN, async (_e, slug: string, step: SetupStep | 'all') =>
    engine.runSetup(slug, step, sink)
  );

  safeHandle(IPC_CHANNELS.INSTANCES.PROC_START, async (_e, slug: string, target: LaunchTarget) =>
    engine.startProcess(slug, target, sink)
  );

  safeHandle(IPC_CHANNELS.INSTANCES.PROC_STOP, async (_e, processId: string) => {
    await engine.stopProcess(processId);
    return { success: true };
  });

  safeHandle(IPC_CHANNELS.INSTANCES.PROC_RESTART, async (_e, processId: string) =>
    engine.restartProcess(processId, sink)
  );

  safeHandle(IPC_CHANNELS.INSTANCES.PROC_REMOVE, async (_e, processId: string) => {
    await engine.removeProcess(processId);
    return { success: true };
  });

  safeHandle(IPC_CHANNELS.INSTANCES.PROC_LIST, async (_e, slug?: string) => ({
    processes: engine.listProcesses(slug),
    scripts: slug ? await engine.listScripts(slug).catch(() => []) : [],
  }));
}
