/**
 * App IPC Handlers
 */

import { app, shell, dialog } from 'electron';
import { IPC_CHANNELS, type AppState, type TabState, type LayoutConfig } from '@mj-forge/shared';
import { AppStateStore } from '../services/config/app-state';
import { safeHandle } from './safe-handle';

export function registerAppHandlers(): void {
  const appState = AppStateStore.getInstance();

  // Get app version
  safeHandle(IPC_CHANNELS.APP.GET_VERSION, async (): Promise<string> => {
    return app.getVersion();
  });

  // Open external URL
  safeHandle(IPC_CHANNELS.APP.OPEN_EXTERNAL, async (_event, url: string): Promise<void> => {
    await shell.openExternal(url);
  });

  // Show in folder
  safeHandle(IPC_CHANNELS.APP.SHOW_IN_FOLDER, async (_event, path: string): Promise<void> => {
    shell.showItemInFolder(path);
  });

  // Get app state
  safeHandle(IPC_CHANNELS.APP.GET_STATE, async (): Promise<AppState> => {
    return appState.getState();
  });

  // Set app state
  safeHandle(
    IPC_CHANNELS.APP.SET_STATE,
    async (_event, partial: Partial<AppState>): Promise<void> => {
      appState.setState(partial);
    }
  );

  // Save tabs
  safeHandle(
    IPC_CHANNELS.APP.SAVE_TABS,
    async (_event, tabs: TabState[], activeTabId: string | null): Promise<void> => {
      appState.setOpenTabs(tabs);
      appState.setActiveTabId(activeTabId);
    }
  );

  // Get saved tabs
  safeHandle(
    IPC_CHANNELS.APP.GET_TABS,
    async (): Promise<{ tabs: TabState[]; activeTabId: string | null }> => {
      return {
        tabs: appState.getOpenTabs(),
        activeTabId: appState.getActiveTabId(),
      };
    }
  );

  // Show open dialog
  safeHandle(
    IPC_CHANNELS.APP.SHOW_OPEN_DIALOG,
    async (_event, options: Electron.OpenDialogOptions) => {
      return dialog.showOpenDialog(options);
    }
  );

  // Show save dialog
  safeHandle(
    IPC_CHANNELS.APP.SHOW_SAVE_DIALOG,
    async (_event, options: Electron.SaveDialogOptions) => {
      return dialog.showSaveDialog(options);
    }
  );

  // General-purpose file write (for exports — user chose the path via save dialog)
  safeHandle(IPC_CHANNELS.APP.SAVE_TO_FILE, async (_event, filePath: string, content: string) => {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, content, 'utf-8');
  });

  // Save golden layout config
  safeHandle(
    IPC_CHANNELS.APP.SAVE_LAYOUT,
    async (_event, config: LayoutConfig | undefined): Promise<void> => {
      appState.setGoldenLayoutConfig(config);
    }
  );

  // Get golden layout config
  safeHandle(IPC_CHANNELS.APP.GET_LAYOUT, async (): Promise<LayoutConfig | undefined> => {
    return appState.getGoldenLayoutConfig();
  });
}
