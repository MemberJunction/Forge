/**
 * Server File System IPC Handlers
 * Handles browsing the SQL Server's file system
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import { ServerFilesystemService } from '../services/sql/server-filesystem';

const serverFs = new ServerFilesystemService();

export function registerServerFsHandlers(): void {
  // Get available drives
  ipcMain.handle(IPC_CHANNELS.SERVER_FS.GET_DRIVES, async (_event, connectionId: string) => {
    return serverFs.getDrives(connectionId);
  });

  // List directory contents
  ipcMain.handle(
    IPC_CHANNELS.SERVER_FS.LIST_DIRECTORY,
    async (_event, connectionId: string, path: string, includeFiles = true) => {
      return serverFs.listDirectory(connectionId, path, includeFiles);
    }
  );

  // Get default paths
  ipcMain.handle(IPC_CHANNELS.SERVER_FS.GET_DEFAULT_PATHS, async (_event, connectionId: string) => {
    return serverFs.getDefaultPaths(connectionId);
  });
}
