/**
 * PostgreSQL Backup/Restore Service
 *
 * Uses pg_dump and pg_restore CLI tools (not SQL commands).
 * Requires pg_dump/pg_restore to be installed on the machine running Forge.
 */

import { spawn } from 'child_process';
import { BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { BackupRequest, RestoreRequest } from '@mj-forge/shared';
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
   * Start a PostgreSQL backup using pg_dump
   */
  async startBackup(request: BackupRequest): Promise<string> {
    const operationId = uuidv4();
    const profile = this.profileStore.getById(request.connectionId);
    if (!profile) throw new Error('Connection profile not found');

    const password = await this.profileStore.getPassword(request.connectionId);

    const operation: PgBackupOperation = { id: operationId, type: 'backup', cancelled: false };
    this.activeOperations.set(operationId, operation);

    const args = [
      '-h', profile.server,
      '-p', String(profile.port),
      '-U', profile.username || 'postgres',
      '-d', request.database,
      '-F', 'c', // custom format (compressed, supports pg_restore)
      '-v', // verbose for progress
      '-f', request.backupPath || `/tmp/${request.database}_${Date.now()}.dump`,
    ];

    log.info(`Starting pg_dump for ${request.database} → ${request.backupPath}`);

    const env = { ...process.env };
    if (password) env.PGPASSWORD = password;

    return new Promise((resolve, reject) => {
      const proc = spawn('pg_dump', args, { env });
      operation.pid = proc.pid;

      let stderr = '';

      proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        stderr += msg;
        // Send progress to renderer
        this.sendProgress(operationId, 'backup', msg.trim());
      });

      proc.on('close', (code) => {
        this.activeOperations.delete(operationId);
        if (operation.cancelled) {
          this.sendComplete(operationId, 'backup', false, 'Backup cancelled');
          resolve(operationId);
        } else if (code === 0) {
          log.info(`pg_dump completed successfully for ${request.database}`);
          this.sendComplete(operationId, 'backup', true);
          resolve(operationId);
        } else {
          const errMsg = `pg_dump failed with exit code ${code}: ${stderr.slice(-500)}`;
          log.error(errMsg);
          this.sendComplete(operationId, 'backup', false, errMsg);
          reject(new Error(errMsg));
        }
      });

      proc.on('error', (err) => {
        this.activeOperations.delete(operationId);
        const errMsg = err.message.includes('ENOENT')
          ? 'pg_dump not found. Please install PostgreSQL client tools.'
          : err.message;
        log.error(`pg_dump error: ${errMsg}`);
        this.sendComplete(operationId, 'backup', false, errMsg);
        reject(new Error(errMsg));
      });
    });
  }

  /**
   * Start a PostgreSQL restore using pg_restore
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
      '-h', profile.server,
      '-p', String(profile.port),
      '-U', profile.username || 'postgres',
      '-d', targetDb,
      '-v', // verbose
      request.backupPath,
    ];

    if (request.replaceExisting) {
      args.splice(args.length - 1, 0, '--clean', '--if-exists');
    }

    log.info(`Starting pg_restore for ${request.backupPath} → ${targetDb}`);

    const env = { ...process.env };
    if (password) env.PGPASSWORD = password;

    return new Promise((resolve, reject) => {
      const proc = spawn('pg_restore', args, { env });
      operation.pid = proc.pid;

      let stderr = '';

      proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        stderr += msg;
        this.sendProgress(operationId, 'restore', msg.trim());
      });

      proc.on('close', (code) => {
        this.activeOperations.delete(operationId);
        if (operation.cancelled) {
          this.sendComplete(operationId, 'restore', false, 'Restore cancelled');
          resolve(operationId);
        } else if (code === 0) {
          log.info(`pg_restore completed successfully → ${targetDb}`);
          this.sendComplete(operationId, 'restore', true);
          resolve(operationId);
        } else {
          // pg_restore returns non-zero for warnings too; check stderr
          const hasErrors = stderr.includes('ERROR:');
          if (hasErrors) {
            const errMsg = `pg_restore completed with errors (exit ${code}): ${stderr.slice(-500)}`;
            log.error(errMsg);
            this.sendComplete(operationId, 'restore', false, errMsg);
            reject(new Error(errMsg));
          } else {
            // Warnings only — treat as success
            log.info(`pg_restore completed with warnings for ${targetDb}`);
            this.sendComplete(operationId, 'restore', true);
            resolve(operationId);
          }
        }
      });

      proc.on('error', (err) => {
        this.activeOperations.delete(operationId);
        const errMsg = err.message.includes('ENOENT')
          ? 'pg_restore not found. Please install PostgreSQL client tools.'
          : err.message;
        log.error(`pg_restore error: ${errMsg}`);
        this.sendComplete(operationId, 'restore', false, errMsg);
        reject(new Error(errMsg));
      });
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
        try { process.kill(op.pid); } catch { /* process may have already exited */ }
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
        try { process.kill(op.pid); } catch { /* ignore */ }
      }
      log.info(`Shutdown: stopped PG ${op.type} operation ${id}`);
    }
    this.activeOperations.clear();
  }

  private sendProgress(operationId: string, type: string, message: string): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(`${type}:progress`, { operationId, message });
    }
  }

  private sendComplete(operationId: string, type: string, success: boolean, error?: string): void {
    const channel = success ? `${type}:complete` : `${type}:error`;
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      win.webContents.send(channel, { operationId, success, error });
    }
  }
}
