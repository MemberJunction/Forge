/**
 * App IPC Handlers
 */

import { ipcMain, app, shell } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';

export function registerAppHandlers(): void {
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
}
