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

/**
 * Called when the app is quitting. Processes are detached and tracked in the
 * shared `~/.mjdev/processes.json` registry, so by design they KEEP RUNNING after
 * the GUI quits (agents/CLI may depend on them) — `dispose()` is a no-op reap.
 * Manage them explicitly via the GUI Stop or `mjdev kill`.
 */
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
    engine.startProcess(slug, target, sink, 'gui')
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
    processes: await engine.listProcesses(slug),
    scripts: slug ? await engine.listScripts(slug).catch(() => []) : [],
  }));

  safeHandle(IPC_CHANNELS.INSTANCES.RUN_OPTIONS, async (_e, slug: string) =>
    engine.listRunTargets(slug).catch(() => [])
  );

  safeHandle(IPC_CHANNELS.INSTANCES.PROC_LOGS, async (_e, processId: string, sinceByte: number) =>
    engine.processLogsSince(processId, sinceByte ?? 0)
  );

  // ── Open App dev-linking (Phase B) ──────────────────────────────────────────
  safeHandle(
    IPC_CHANNELS.OPEN_APPS.LINK,
    async (
      _e,
      slug: string,
      appRef: string,
      opts?: {
        ignoreVersionRange?: boolean;
        allowDoubleUnderscore?: boolean;
        appBranch?: string;
        baseRef?: string;
      }
    ) => engine.linkApp(slug, appRef, opts ?? {}, sink)
  );

  safeHandle(
    IPC_CHANNELS.OPEN_APPS.INSTALL,
    async (
      _e,
      slug: string,
      source: string,
      opts?: { version?: string; allowDoubleUnderscore?: boolean }
    ) => engine.installApp(slug, source, opts ?? {}, sink)
  );

  safeHandle(IPC_CHANNELS.OPEN_APPS.RESOLVE_DEPS, async (_e, slug: string, appRef: string) =>
    engine.resolveAppDependencies(slug, appRef, sink)
  );

  safeHandle(IPC_CHANNELS.OPEN_APPS.RECENTS, async () => engine.recentApps());

  safeHandle(
    IPC_CHANNELS.OPEN_APPS.REMOVE,
    async (_e, slug: string, appName: string, opts?: { keepData?: boolean; force?: boolean }) => {
      await engine.removeApp(slug, appName, opts ?? {}, sink);
      return { success: true };
    }
  );

  safeHandle(
    IPC_CHANNELS.OPEN_APPS.UNLINK,
    async (_e, slug: string, appName: string, opts?: { dropSchema?: boolean }) => {
      await engine.unlinkApp(slug, appName, opts ?? {}, sink);
      return { success: true };
    }
  );

  safeHandle(
    IPC_CHANNELS.OPEN_APPS.SWITCH_MODE,
    async (_e, slug: string, appName: string, target: 'dev' | 'installed') => {
      await engine.switchAppMode(slug, appName, target, sink);
      return { success: true };
    }
  );

  safeHandle(IPC_CHANNELS.OPEN_APPS.LIST, async (_e, slug: string) => engine.listApps(slug));

  safeHandle(IPC_CHANNELS.OPEN_APPS.DRIFT, async (_e, slug: string, appName: string) =>
    engine.checkAppDrift(slug, appName, sink)
  );

  safeHandle(IPC_CHANNELS.OPEN_APPS.RESET_SCHEMA, async (_e, slug: string, appName: string) => {
    await engine.resetAppSchema(slug, appName, sink);
    return { success: true };
  });

  safeHandle(IPC_CHANNELS.OPEN_APPS.REPAIR_SCHEMA, async (_e, slug: string, appName: string) => {
    await engine.repairAppSchema(slug, appName, sink);
    return { success: true };
  });

  safeHandle(IPC_CHANNELS.OPEN_APPS.BUILD, async (_e, slug: string, appName: string) =>
    engine.buildApp(slug, appName, sink)
  );

  safeHandle(IPC_CHANNELS.OPEN_APPS.BUILD_ALL, async (_e, slug: string) =>
    engine.buildAllApps(slug, sink)
  );

  safeHandle(IPC_CHANNELS.OPEN_APPS.CODEGEN, async (_e, slug: string, appName: string) =>
    engine.codegenApp(slug, appName, sink)
  );

  safeHandle(IPC_CHANNELS.OPEN_APPS.MIGRATE, async (_e, slug: string, appName: string) =>
    engine.migrateApp(slug, appName, sink)
  );
}
