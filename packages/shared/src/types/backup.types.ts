/**
 * Backup and Restore type definitions
 */

export type BackupType = 'full' | 'differential' | 'log';

export interface BackupRequest {
  connectionId: string;
  database: string;
  backupPath: string;
  backupType: BackupType;
  compression?: boolean;
  copyOnly?: boolean;
  checksum?: boolean;
  description?: string;
  backupId?: string;
}

// Legacy alias
export interface BackupOptions {
  connectionId: string;
  databaseName: string;
  destinationPath: string;
  backupType: BackupType | 'full_copy_only';
  compression: boolean;
  verify: boolean;
  description?: string;
}

export interface BackupProgress {
  backupId: string;
  operationId?: string; // alias
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  percentComplete: number;
  percent?: number; // alias
  processedBytes?: number;
  totalBytes?: number;
  elapsedMs?: number;
  estimatedRemainingMs?: number;
  currentPhase?: string;
  error?: string;
}

export interface BackupResult {
  operationId: string;
  success: boolean;
  filePath: string;
  sizeBytes: number;
  durationMs: number;
  tsql: string;
  error?: string;
}

export interface BackupLogicalFile {
  logicalName: string;
  physicalName: string;
  type: 'D' | 'L'; // Data or Log
  fileGroupName?: string;
  sizeBytes?: number;
}

export interface BackupFileInfo {
  databaseName: string;
  backupType: string;
  backupDate: string;
  backupSizeBytes: number;
  compressedSizeBytes?: number;
  serverVersion?: string;
  serverName?: string;
  compatibilityLevel?: number;
  collation?: string;
  files: BackupLogicalFile[];
}

export interface FileRelocation {
  logicalName: string;
  newPath: string;
}

export interface RestoreRequest {
  connectionId: string;
  backupPath: string;
  targetDatabase: string;
  fileRelocations?: FileRelocation[];
  replaceExisting?: boolean;
  recoveryState?: 'RECOVERY' | 'NORECOVERY' | 'STANDBY';
  restoreId?: string;
}

// Legacy alias
export interface RestoreOptions {
  connectionId: string;
  sourcePath: string;
  targetDatabaseName: string;
  overwriteExisting: boolean;
  fileMoves: FileMove[];
  recoveryState: 'recovery' | 'norecovery' | 'standby';
}

export interface FileMove {
  logicalName: string;
  destinationPath: string;
}

export interface RestoreProgress {
  restoreId: string;
  operationId?: string; // alias
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  percentComplete: number;
  percent?: number; // alias
  processedBytes?: number;
  totalBytes?: number;
  elapsedMs?: number;
  estimatedRemainingMs?: number;
  currentPhase?: string;
  error?: string;
}

export interface RestoreResult {
  operationId: string;
  success: boolean;
  databaseName: string;
  durationMs: number;
  tsql: string;
  error?: string;
}
