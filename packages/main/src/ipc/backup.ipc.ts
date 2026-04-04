/**
 * Backup IPC Handlers
 *
 * SQL Server: uses BACKUP/RESTORE DATABASE T-SQL commands
 * PostgreSQL: uses pg_dump/pg_restore CLI tools (TODO: implement PgBackupProvider)
 */

import { IPC_CHANNELS } from '@mj-forge/shared';
import type { BackupRequest, BackupFileInfo, RestoreRequest } from '@mj-forge/shared';
import { BackupRestoreService } from '../services/sql/backup-restore';
import { PgBackupService } from '../services/sql/pg-backup';
import { ServerFilesystemService } from '../services/sql/server-filesystem';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { safeHandle } from './safe-handle';

function getEngine(connectionId: string): string {
  return ConnectionPoolManager.getInstance().getEngineForProfile(connectionId);
}

export function registerBackupHandlers(): void {
  const backupService = BackupRestoreService.getInstance();
  const pgBackupService = PgBackupService.getInstance();
  const serverFs = new ServerFilesystemService();

  // Start backup — routes to correct provider
  safeHandle(
    IPC_CHANNELS.BACKUP.START,
    async (_event, request: BackupRequest): Promise<string> => {
      if (getEngine(request.connectionId) === 'postgresql') {
        return pgBackupService.startBackup(request);
      }
      return backupService.startBackup(request);
    }
  );

  // Cancel backup
  safeHandle(IPC_CHANNELS.BACKUP.CANCEL, async (_event, operationId: string): Promise<void> => {
    await backupService.cancel(operationId);
  });

  // Read backup info (MSSQL only — PG uses file headers)
  safeHandle(
    IPC_CHANNELS.RESTORE.READ_INFO,
    async (_event, connectionId: string, path: string): Promise<BackupFileInfo> => {
      if (getEngine(connectionId) === 'postgresql') {
        // PG dump files don't have SQL-queryable metadata
        return { databaseName: path.split('/').pop()?.replace(/\.dump$/, '') || 'unknown' } as BackupFileInfo;
      }
      return backupService.readBackupInfo(connectionId, path);
    }
  );

  // Get file list from backup (MSSQL only)
  safeHandle(
    IPC_CHANNELS.RESTORE.GET_FILE_LIST,
    async (
      _event,
      connectionId: string,
      backupPath: string
    ): Promise<{ logicalName: string; physicalName: string; type: string }[]> => {
      if (getEngine(connectionId) === 'postgresql') {
        return []; // PG dump format doesn't have logical file mapping
      }
      return backupService.getFileList(connectionId, backupPath);
    }
  );

  // Start restore — routes to correct provider
  safeHandle(
    IPC_CHANNELS.RESTORE.START,
    async (_event, request: RestoreRequest): Promise<string> => {
      if (getEngine(request.connectionId) === 'postgresql') {
        return pgBackupService.startRestore(request);
      }
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

  // Get backup history (MSSQL only — PG has no backup metadata tables)
  safeHandle(
    IPC_CHANNELS.BACKUP.GET_HISTORY,
    async (_event, connectionId: string, databaseName?: string) => {
      if (getEngine(connectionId) === 'postgresql') {
        return []; // PG doesn't store backup history in system tables
      }
      return serverFs.getBackupHistory(connectionId, databaseName);
    }
  );

  // Get backup info (header info from backup file)
  safeHandle(
    IPC_CHANNELS.RESTORE.GET_BACKUP_INFO,
    async (_event, connectionId: string, backupPath: string): Promise<BackupFileInfo> => {
      if (getEngine(connectionId) === 'postgresql') {
        return { databaseName: backupPath.split('/').pop()?.replace(/\.dump$/, '') || 'unknown' } as BackupFileInfo;
      }
      return backupService.readBackupInfo(connectionId, backupPath);
    }
  );
}
