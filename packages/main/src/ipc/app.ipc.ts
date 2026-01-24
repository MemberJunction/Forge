/**
 * App IPC Handlers
 */

import { ipcMain, app, shell, dialog } from 'electron';
import { IPC_CHANNELS, type AppState, type TabState } from '@mj-forge/shared';
import { AppStateStore } from '../services/config/app-state';

export function registerAppHandlers(): void {
  const appState = AppStateStore.getInstance();

  // Get app version
  ipcMain.handle(IPC_CHANNELS.APP.GET_VERSION, async (): Promise<string> => {
    return app.getVersion();
  });

  // Open external URL
  ipcMain.handle(IPC_CHANNELS.APP.OPEN_EXTERNAL, async (_event, url: string): Promise<void> => {
    await shell.openExternal(url);
  });

  // Show in folder
  ipcMain.handle(IPC_CHANNELS.APP.SHOW_IN_FOLDER, async (_event, path: string): Promise<void> => {
    shell.showItemInFolder(path);
  });

  // Get app state
  ipcMain.handle(IPC_CHANNELS.APP.GET_STATE, async (): Promise<AppState> => {
    return appState.getState();
  });

  // Set app state
  ipcMain.handle(IPC_CHANNELS.APP.SET_STATE, async (_event, partial: Partial<AppState>): Promise<void> => {
    appState.setState(partial);
  });

  // Save tabs
  ipcMain.handle(IPC_CHANNELS.APP.SAVE_TABS, async (_event, tabs: TabState[], activeTabId: string | null): Promise<void> => {
    appState.setOpenTabs(tabs);
    appState.setActiveTabId(activeTabId);
  });

  // Get saved tabs
  ipcMain.handle(IPC_CHANNELS.APP.GET_TABS, async (): Promise<{ tabs: TabState[]; activeTabId: string | null }> => {
    return {
      tabs: appState.getOpenTabs(),
      activeTabId: appState.getActiveTabId(),
    };
  });

  // Show open dialog
  ipcMain.handle(IPC_CHANNELS.APP.SHOW_OPEN_DIALOG, async (_event, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(options);
  });

  // Show save dialog
  ipcMain.handle(IPC_CHANNELS.APP.SHOW_SAVE_DIALOG, async (_event, options: Electron.SaveDialogOptions) => {
    return dialog.showSaveDialog(options);
  });
}
