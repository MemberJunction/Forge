/**
 * MySQL Backup/Restore Service
 *
 * Uses mysqldump and mysql CLI tools (not SQL commands).
 * Requires mysqldump/mysql to be installed on the machine running Forge.
 */

import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { Transform } from 'stream';
import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type {
  BackupProgress,
  BackupRequest,
  RestoreProgress,
  RestoreRequest,
} from '@mj-forge/shared';
import { IPC_CHANNELS } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { ConnectionProfilesStore } from '../config/connection-profiles';

const log = createLogger('MySQLBackup');

interface MySQLBackupOperation {
  id: string;
  type: 'backup' | 'restore';
  cancelled: boolean;
  pid?: number;
}

export class MySQLBackupService extends BaseSingleton {
  private activeOperations: Map<string, MySQLBackupOperation> = new Map();
  private profileStore: ConnectionProfilesStore;

  constructor() {
    super();
    this.profileStore = ConnectionProfilesStore.getInstance();
  }

  /**
   * Start a MySQL backup using mysqldump.
   * Returns the operationId immediately — the dump runs in the background
   * and reports progress/completion via IPC events.
   */
  async startBackup(request: BackupRequest): Promise<string> {
    const operationId = uuidv4();
    const profile = this.profileStore.getById(request.connectionId);
    if (!profile) throw new Error('Connection profile not found');

    const password = await this.profileStore.getPassword(request.connectionId);

    const operation: MySQLBackupOperation = { id: operationId, type: 'backup', cancelled: false };
    this.activeOperations.set(operationId, operation);

    const backupPath = request.backupPath || `/tmp/${request.database}_${Date.now()}.sql`;

    // Build args with minimal privilege requirements. The key challenge is that
    // --single-transaction does a FLUSH TABLES WITH READ LOCK on some versions,
    // which requires RELOAD privilege that many managed DB users don't have.
    // Instead we use --skip-lock-tables + --skip-opt + --create-options to get
    // a clean dump without requiring RELOAD, PROCESS, or SUPER privileges.
    const args = [
      '-h',
      profile.server,
      '-P',
      String(profile.port),
      '-u',
      profile.username || 'root',
      '--skip-opt',
      '--create-options',
      '--add-drop-table',
      '--set-charset',
      '--extended-insert',
      '--quick',
      '--triggers',
      '--no-tablespaces',
      '--set-gtid-purged=OFF',
      '--column-statistics=0',
      '--result-file',
      backupPath,
      request.database,
    ];

    log.info(`Starting mysqldump for ${request.database} → ${backupPath}`);

    const env = { ...process.env };
    if (password) env.MYSQL_PWD = password;

    // Fire and forget — run in background, report via IPC events
    this.runBackupProcess(operationId, request.database, args, env, operation);

    return operationId;
  }

  private runBackupProcess(
    operationId: string,
    database: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    operation: MySQLBackupOperation
  ): void {
    const proc = spawn('mysqldump', args, { env });
    operation.pid = proc.pid;

    let stderr = '';

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      this.sendProgress(operationId, 'backup', msg.trim());
    });

    proc.on('close', code => {
      this.activeOperations.delete(operationId);
      if (operation.cancelled) {
        this.sendComplete(operationId, 'backup', false, 'Backup cancelled');
      } else if (code === 0) {
        log.info(`mysqldump completed successfully for ${database}`);
        this.sendComplete(operationId, 'backup', true);
      } else {
        const errMsg = `mysqldump failed with exit code ${code}: ${stderr.slice(-500)}`;
        log.error(errMsg);
        this.sendComplete(operationId, 'backup', false, errMsg);
      }
    });

    proc.on('error', err => {
      this.activeOperations.delete(operationId);
      const errMsg = err.message.includes('ENOENT')
        ? 'mysqldump not found. Please install MySQL client tools.'
        : err.message;
      log.error(`mysqldump error: ${errMsg}`);
      this.sendComplete(operationId, 'backup', false, errMsg);
    });
  }

  /**
   * Start a MySQL restore by piping a SQL file to the mysql CLI.
   * Returns the operationId immediately — the restore runs in the background.
   */
  async startRestore(request: RestoreRequest): Promise<string> {
    const operationId = uuidv4();
    const profile = this.profileStore.getById(request.connectionId);
    if (!profile) throw new Error('Connection profile not found');

    const password = await this.profileStore.getPassword(request.connectionId);

    const operation: MySQLBackupOperation = { id: operationId, type: 'restore', cancelled: false };
    this.activeOperations.set(operationId, operation);

    const targetDb = request.targetDatabase || 'restored_db';

    const args = [
      '-h',
      profile.server,
      '-P',
      String(profile.port),
      '-u',
      profile.username || 'root',
      targetDb,
    ];

    log.info(`Starting mysql restore for ${request.backupPath} → ${targetDb}`);

    const env = { ...process.env };
    if (password) env.MYSQL_PWD = password;

    // Fire and forget — run in background, report via IPC events
    this.runRestoreProcess(operationId, targetDb, request.backupPath, args, env, operation);

    return operationId;
  }

  /**
   * Create a transform stream that strips SQL statements requiring SUPER privilege.
   * Dump files from managed MySQL instances (RDS, Cloud SQL, etc.) often contain
   * SET @@SESSION.SQL_LOG_BIN, SET @@GLOBAL.GTID_PURGED, and similar statements
   * that fail without SUPER or SYSTEM_VARIABLES_ADMIN privileges.
   */
  private createPrivilegeFilter(): Transform {
    let buffer = '';
    return new Transform({
      transform(chunk, _encoding, callback) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        // Keep the last partial line in the buffer
        buffer = lines.pop() || '';
        const filtered =
          lines
            .filter(line => {
              const trimmed = line.trimStart();
              return (
                !trimmed.startsWith('SET @@SESSION.SQL_LOG_BIN') &&
                !trimmed.startsWith('SET @@GLOBAL.GTID_PURGED') &&
                !trimmed.startsWith('SET @@GLOBAL.gtid_purged')
              );
            })
            .join('\n') + '\n';
        callback(null, filtered);
      },
      flush(callback) {
        if (buffer) callback(null, buffer);
        else callback();
      },
    });
  }

  private runRestoreProcess(
    operationId: string,
    targetDb: string,
    backupPath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    operation: MySQLBackupOperation
  ): void {
    const proc = spawn('mysql', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    operation.pid = proc.pid;

    let stderr = '';

    // Pipe the SQL file through a filter that strips SUPER-privilege statements
    const fileStream = createReadStream(backupPath);
    const filter = this.createPrivilegeFilter();
    fileStream.pipe(filter).pipe(proc.stdin);

    fileStream.on('error', err => {
      this.activeOperations.delete(operationId);
      const errMsg = `Failed to read backup file: ${err.message}`;
      log.error(errMsg);
      this.sendComplete(operationId, 'restore', false, errMsg);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      this.sendProgress(operationId, 'restore', msg.trim());
    });

    proc.on('close', code => {
      this.activeOperations.delete(operationId);
      if (operation.cancelled) {
        this.sendComplete(operationId, 'restore', false, 'Restore cancelled');
      } else if (code === 0) {
        log.info(`mysql restore completed successfully → ${targetDb}`);
        this.sendComplete(operationId, 'restore', true);
      } else {
        const errMsg = `mysql restore failed with exit code ${code}: ${stderr.slice(-500)}`;
        log.error(errMsg);
        this.sendComplete(operationId, 'restore', false, errMsg);
      }
    });

    proc.on('error', err => {
      this.activeOperations.delete(operationId);
      const errMsg = err.message.includes('ENOENT')
        ? 'mysql client not found. Please install MySQL client tools.'
        : err.message;
      log.error(`mysql restore error: ${errMsg}`);
      this.sendComplete(operationId, 'restore', false, errMsg);
    });
  }

  /**
   * Cancel a running backup/restore operation
   */
  cancel(operationId: string): void {
    const op = this.activeOperations.get(operationId);
    if (op) {
      op.cancelled = true;
      if (op.pid) {
        try {
          process.kill(op.pid);
        } catch {
          /* process may have already exited */
        }
      }
    }
  }

  /**
   * Stop all operations (for app shutdown)
   */
  stopAllOperations(): void {
    for (const [id, op] of this.activeOperations) {
      op.cancelled = true;
      if (op.pid) {
        try {
          process.kill(op.pid);
        } catch {
          /* ignore */
        }
      }
      log.info(`Shutdown: stopped MySQL ${op.type} operation ${id}`);
    }
    this.activeOperations.clear();
  }

  private sendProgress(operationId: string, type: 'backup' | 'restore', message: string): void {
    const channel =
      type === 'backup' ? IPC_CHANNELS.BACKUP.PROGRESS : IPC_CHANNELS.RESTORE.PROGRESS;
    const progress: BackupProgress | RestoreProgress = {
      backupId: operationId,
      operationId,
      status: 'running',
      percentComplete: -1, // indeterminate — CLI tools don't report %
      currentPhase: message,
    };
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(channel, progress);
    }
  }

  private sendComplete(
    operationId: string,
    type: 'backup' | 'restore',
    success: boolean,
    error?: string
  ): void {
    const channel =
      type === 'backup' ? IPC_CHANNELS.BACKUP.PROGRESS : IPC_CHANNELS.RESTORE.PROGRESS;
    const progress: BackupProgress | RestoreProgress = {
      backupId: operationId,
      operationId,
      status: success ? 'completed' : 'failed',
      percentComplete: success ? 100 : 0,
      currentPhase: success ? 'Completed' : 'Failed',
      error,
    };
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(channel, progress);
    }
  }
}
