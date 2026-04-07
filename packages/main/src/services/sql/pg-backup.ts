/**
 * PostgreSQL Backup/Restore Service
 *
 * Uses pg_dump and pg_restore CLI tools (not SQL commands).
 * Requires pg_dump/pg_restore to be installed on the machine running Forge.
 */

import { spawn } from 'child_process';
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

const log = createLogger('PgBackup');

interface PgBackupOperation {
  id: string;
  type: 'backup' | 'restore';
  cancelled: boolean;
  pid?: number;
}

export class PgBackupService extends BaseSingleton {
  private activeOperations: Map<string, PgBackupOperation> = new Map();
  private profileStore: ConnectionProfilesStore;

  constructor() {
    super();
    this.profileStore = ConnectionProfilesStore.getInstance();
  }

  /**
   * Start a PostgreSQL backup using pg_dump.
   * Returns the operationId immediately — the dump runs in the background.
   */
  async startBackup(request: BackupRequest): Promise<string> {
    const operationId = uuidv4();
    const profile = this.profileStore.getById(request.connectionId);
    if (!profile) throw new Error('Connection profile not found');

    const password = await this.profileStore.getPassword(request.connectionId);

    const operation: PgBackupOperation = { id: operationId, type: 'backup', cancelled: false };
    this.activeOperations.set(operationId, operation);

    const args = [
      '-h',
      profile.server,
      '-p',
      String(profile.port),
      '-U',
      profile.username || 'postgres',
      '-d',
      request.database,
      '-F',
      'c', // custom format (compressed, supports pg_restore)
      '-v', // verbose for progress
      '-f',
      request.backupPath || `/tmp/${request.database}_${Date.now()}.dump`,
    ];

    log.info(`Starting pg_dump for ${request.database} → ${request.backupPath}`);

    const env = { ...process.env };
    if (password) env.PGPASSWORD = password;

    // Fire and forget — run in background, report via IPC events
    this.runProcess(operationId, 'pg_dump', args, env, operation, 'backup');

    return operationId;
  }

  /**
   * Start a PostgreSQL restore using pg_restore.
   * Returns the operationId immediately — the restore runs in the background.
   */
  async startRestore(request: RestoreRequest): Promise<string> {
    const operationId = uuidv4();
    const profile = this.profileStore.getById(request.connectionId);
    if (!profile) throw new Error('Connection profile not found');

    const password = await this.profileStore.getPassword(request.connectionId);

    const operation: PgBackupOperation = { id: operationId, type: 'restore', cancelled: false };
    this.activeOperations.set(operationId, operation);

    const targetDb = request.targetDatabase || 'restored_db';

    const args = [
      '-h',
      profile.server,
      '-p',
      String(profile.port),
      '-U',
      profile.username || 'postgres',
      '-d',
      targetDb,
      '-v', // verbose
      request.backupPath,
    ];

    if (request.replaceExisting) {
      args.splice(args.length - 1, 0, '--clean', '--if-exists');
    }

    log.info(`Starting pg_restore for ${request.backupPath} → ${targetDb}`);

    const env = { ...process.env };
    if (password) env.PGPASSWORD = password;

    // Fire and forget — run in background, report via IPC events
    this.runProcess(operationId, 'pg_restore', args, env, operation, 'restore');

    return operationId;
  }

  /**
   * Spawn a CLI tool in the background and report progress/completion via IPC.
   */
  private runProcess(
    operationId: string,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    operation: PgBackupOperation,
    type: 'backup' | 'restore'
  ): void {
    const proc = spawn(command, args, { env });
    operation.pid = proc.pid;

    let stderr = '';

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      this.sendProgress(operationId, type, msg.trim());
    });

    proc.on('close', code => {
      this.activeOperations.delete(operationId);
      if (operation.cancelled) {
        this.sendComplete(operationId, type, false, `${command} cancelled`);
      } else if (code === 0) {
        log.info(`${command} completed successfully (${operationId})`);
        this.sendComplete(operationId, type, true);
      } else {
        // pg_restore returns non-zero for warnings too; check stderr
        if (command === 'pg_restore' && !stderr.includes('ERROR:')) {
          log.info(`${command} completed with warnings (${operationId})`);
          this.sendComplete(operationId, type, true);
        } else {
          const errMsg = `${command} failed with exit code ${code}: ${stderr.slice(-500)}`;
          log.error(errMsg);
          this.sendComplete(operationId, type, false, errMsg);
        }
      }
    });

    proc.on('error', err => {
      this.activeOperations.delete(operationId);
      const errMsg = err.message.includes('ENOENT')
        ? `${command} not found. Please install PostgreSQL client tools.`
        : err.message;
      log.error(`${command} error: ${errMsg}`);
      this.sendComplete(operationId, type, false, errMsg);
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
      log.info(`Shutdown: stopped PG ${op.type} operation ${id}`);
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
