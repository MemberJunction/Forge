/**
 * MJ Forge - Main Process Entry Point
 */

import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { createMenu } from './menu';
import { registerAllHandlers } from './ipc';
import { ConnectionPoolManager } from './services/sql/connection-pool';
import { CredentialStore } from './services/keychain/credential-store';

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

  // Cleanup before quit
  app.on('before-quit', async () => {
    // Close all SQL connections
    const poolManager = ConnectionPoolManager.getInstance();
    poolManager.stopCleanupTimer();
    await poolManager.closeAll();
  });
}

// Handle uncaught exceptions
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', reason => {
  console.error('Unhandled rejection:', reason);
});
