/**
 * Backup IPC Handlers
 */

import { IPC_CHANNELS } from '@mj-forge/shared';
import type { BackupRequest, BackupFileInfo, RestoreRequest } from '@mj-forge/shared';
import { BackupRestoreService } from '../services/sql/backup-restore';
import { ServerFilesystemService } from '../services/sql/server-filesystem';
import { safeHandle } from './safe-handle';

export function registerBackupHandlers(): void {
  const backupService = BackupRestoreService.getInstance();
  const serverFs = new ServerFilesystemService();

  // Start backup
  safeHandle(
    IPC_CHANNELS.BACKUP.START,
    async (_event, request: BackupRequest): Promise<string> => {
      return backupService.startBackup(request);
    }
  );

  // Cancel backup
  safeHandle(IPC_CHANNELS.BACKUP.CANCEL, async (_event, operationId: string): Promise<void> => {
    await backupService.cancel(operationId);
  });

  // Read backup info
  safeHandle(
    IPC_CHANNELS.RESTORE.READ_INFO,
    async (_event, connectionId: string, path: string): Promise<BackupFileInfo> => {
      return backupService.readBackupInfo(connectionId, path);
    }
  );

  // Get file list from backup
  safeHandle(
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
  safeHandle(
    IPC_CHANNELS.RESTORE.START,
    async (_event, request: RestoreRequest): Promise<string> => {
      return backupService.startRestore(request);
    }
  );

  // Cancel restore
  safeHandle(
    IPC_CHANNELS.RESTORE.CANCEL,
    async (_event, operationId: string): Promise<void> => {
      await backupService.cancel(operationId);
    }
  );

  // Get backup history
  safeHandle(
    IPC_CHANNELS.BACKUP.GET_HISTORY,
    async (_event, connectionId: string, databaseName?: string) => {
      return serverFs.getBackupHistory(connectionId, databaseName);
    }
  );

  // Get backup info (header info from backup file)
  safeHandle(
    IPC_CHANNELS.RESTORE.GET_BACKUP_INFO,
    async (_event, connectionId: string, backupPath: string): Promise<BackupFileInfo> => {
      return backupService.readBackupInfo(connectionId, backupPath);
    }
  );
}
