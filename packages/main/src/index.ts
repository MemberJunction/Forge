/**
 * MJ Forge - Main Process Entry Point
 */

import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { createMenu } from './menu';
import { registerAllHandlers } from './ipc';
import { createLogger } from './utils/logger';
import { ConnectionPoolManager } from './services/sql/connection-pool';
import { QueryExecutor } from './services/sql/query-executor';
import { BackupRestoreService } from './services/sql/backup-restore';
import { ChatService } from './services/ai/chat-service';
import { AIService } from './services/ai/ai-service';
import { CredentialStore } from './services/keychain/credential-store';
import { cleanupWorkspaceWatchers } from './ipc/workspace.ipc';

const log = createLogger('App');

// Handle creating/removing shortcuts on Windows when installing/uninstalling
// This is only needed for Windows Squirrel installers
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // electron-squirrel-startup not installed, ignore
}

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      if (windows[0].isMinimized()) {
        windows[0].restore();
      }
      windows[0].focus();
    }
  });

  // App ready
  app.whenReady().then(async () => {
    // Preload all credentials into memory cache (single keychain access at startup)
    const credentialStore = CredentialStore.getInstance();
    await credentialStore.loadAllIntoCache();

    // Register IPC handlers
    registerAllHandlers();

    // Create menu
    createMenu();

    // Create main window
    createMainWindow();

    // macOS: Re-create window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  // Quit when all windows are closed (except on macOS)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Cleanup before quit — Electron does NOT await async before-quit handlers,
  // so we prevent the default quit, run cleanup ourselves, then force exit.
  let isQuitting = false;
  app.on('before-quit', (event) => {
    if (isQuitting) return; // Already running shutdown sequence
    isQuitting = true;
    event.preventDefault(); // Hold quit until cleanup finishes (or times out)

    const shutdownStart = Date.now();
    log.info('Shutdown: starting graceful cleanup...');

    // Force-exit safety net — if cleanup hangs, exit anyway
    const SHUTDOWN_TIMEOUT_MS = 3000;
    const forceExitTimer = setTimeout(() => {
      log.warn(`Shutdown: timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      app.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);

    // --- Synchronous cleanup (timers, watchers, in-flight work) ---
    const poolManager = ConnectionPoolManager.getInstance();
    poolManager.stopCleanupTimer();
    log.info('Shutdown: stopped pool cleanup timer');

    cleanupWorkspaceWatchers();
    log.info('Shutdown: closed workspace file watchers');

    try { QueryExecutor.getInstance().cancelAll(); } catch { /* singleton may not exist */ }
    log.info('Shutdown: cancelled active queries');

    try { BackupRestoreService.getInstance().stopAllOperations(); } catch { /* singleton may not exist */ }
    log.info('Shutdown: stopped backup/restore operations');

    try { ChatService.getInstance().abortAll(); } catch { /* singleton may not exist */ }
    try { AIService.getInstance().abortAll(); } catch { /* singleton may not exist */ }
    log.info('Shutdown: aborted active AI streams');

    // --- Async cleanup (close SQL pools) ---
    poolManager.closeAll()
      .then(() => log.info(`Shutdown: closed all SQL pools in ${Date.now() - shutdownStart}ms`))
      .catch((err) => log.error('Shutdown: error closing SQL pools:', err))
      .finally(() => {
        clearTimeout(forceExitTimer);
        log.info(`Shutdown: complete in ${Date.now() - shutdownStart}ms`);
        app.exit(0);
      });
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  log.error('Uncaught exception:', error);
});

process.on('unhandledRejection', reason => {
  log.error('Unhandled rejection:', reason);
});
