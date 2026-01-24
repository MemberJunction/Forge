/**
 * Backup IPC Handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type { BackupRequest, BackupFileInfo, RestoreRequest } from '@mj-forge/shared';
import { BackupRestoreService } from '../services/sql/backup-restore';

export function registerBackupHandlers(): void {
  const backupService = BackupRestoreService.getInstance();

  // Start backup
  ipcMain.handle(
    IPC_CHANNELS.BACKUP.START,
    async (_event, request: BackupRequest): Promise<string> => {
      return backupService.startBackup(request);
    }
  );

  // Cancel backup
  ipcMain.handle(IPC_CHANNELS.BACKUP.CANCEL, async (_event, operationId: string): Promise<void> => {
    await backupService.cancel(operationId);
  });

  // Read backup info
  ipcMain.handle(
    IPC_CHANNELS.RESTORE.READ_INFO,
    async (_event, connectionId: string, path: string): Promise<BackupFileInfo> => {
      return backupService.readBackupInfo(connectionId, path);
    }
  );

  // Get file list from backup
  ipcMain.handle(
    IPC_CHANNELS.RESTORE.GET_FILE_LIST,
    async (
      _event,
      connectionId: string,
      backupPath: string
    ): Promise<{ logicalName: string; physicalName: string; type: string }[]> => {
      return backupService.getFileList(connectionId, backupPath);
    }
  );

  // Start restore
  ipcMain.handle(
    IPC_CHANNELS.RESTORE.START,
    async (_event, request: RestoreRequest): Promise<string> => {
      return backupService.startRestore(request);
    }
  );

  // Cancel restore
  ipcMain.handle(
    IPC_CHANNELS.RESTORE.CANCEL,
    async (_event, operationId: string): Promise<void> => {
      await backupService.cancel(operationId);
    }
  );
}
