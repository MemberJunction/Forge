/**
 * Backup IPC Handlers
 *
 * SQL Server: uses BACKUP/RESTORE DATABASE T-SQL commands
 * PostgreSQL: uses pg_dump/pg_restore CLI tools (TODO: implement PgBackupProvider)
 */

import { IPC_CHANNELS } from '@mj-forge/shared';
import type { BackupRequest, BackupFileInfo, RestoreRequest } from '@mj-forge/shared';
import { BackupRestoreService } from '../services/sql/backup-restore';
import { ServerFilesystemService } from '../services/sql/server-filesystem';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { safeHandle } from './safe-handle';

function assertEngineSupports(connectionId: string, feature: string): void {
  const pool = ConnectionPoolManager.getInstance();
  const dialect = pool.getDialectForProfile(connectionId);
  if (!dialect.supportsBackupRestore) {
    throw new Error(
      `${feature} via SQL is not supported for ${dialect.label}. ` +
      `PostgreSQL uses pg_dump/pg_restore CLI tools instead.`
    );
  }
}

export function registerBackupHandlers(): void {
  const backupService = BackupRestoreService.getInstance();
  const serverFs = new ServerFilesystemService();

  // Start backup
  safeHandle(
    IPC_CHANNELS.BACKUP.START,
    async (_event, request: BackupRequest): Promise<string> => {
      assertEngineSupports(request.connectionId, 'Backup');
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
      assertEngineSupports(connectionId, 'Restore');
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
      assertEngineSupports(connectionId, 'Restore');
      return backupService.getFileList(connectionId, backupPath);
    }
  );

  // Start restore
  safeHandle(
    IPC_CHANNELS.RESTORE.START,
    async (_event, request: RestoreRequest): Promise<string> => {
      assertEngineSupports(request.connectionId, 'Restore');
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
      assertEngineSupports(connectionId, 'Backup history');
      return serverFs.getBackupHistory(connectionId, databaseName);
    }
  );

  // Get backup info (header info from backup file)
  safeHandle(
    IPC_CHANNELS.RESTORE.GET_BACKUP_INFO,
    async (_event, connectionId: string, backupPath: string): Promise<BackupFileInfo> => {
      assertEngineSupports(connectionId, 'Restore');
      return backupService.readBackupInfo(connectionId, backupPath);
    }
  );
}
