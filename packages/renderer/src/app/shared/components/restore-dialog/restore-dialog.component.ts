/**
 * Restore Database Dialog Component
 * Modal dialog for restoring a database from a backup file with server-side file browsing
 */

import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialog,
} from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTableModule } from '@angular/material/table';
import { Subscription } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  ServerFileBrowserComponent,
  ServerFileBrowserDialogData,
} from '../server-file-browser/server-file-browser.component';
import type {
  RestoreRequest,
  RestoreProgress,
  BackupFileInfo,
  FileRelocation,
} from '@mj-forge/shared';

export interface RestoreDialogData {
  connectionId: string;
  databaseName?: string; // Pre-fill if restoring to specific database
}

@Component({
  selector: 'app-restore-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatExpansionModule,
    MatTableModule,
  ],
  template: `
    <div class="restore-dialog">
      <h2 mat-dialog-title>
        <mat-icon>restore</mat-icon>
        Restore Database
      </h2>

      <mat-dialog-content>
        <!-- Backup File Selection -->
        <div class="section">
          <h3>Source</h3>
          <div class="path-row">
            <mat-form-field appearance="outline" class="flex-1">
              <mat-label>Backup File (on SQL Server)</mat-label>
              <input
                matInput
                [(ngModel)]="formData.backupPath"
                [disabled]="restoring()"
                placeholder="e.g., D:\\Backups\\MyDatabase.bak"
                (ngModelChange)="onBackupPathChange()"
              />
            </mat-form-field>
            <button mat-stroked-button [disabled]="restoring()" (click)="browseBackupFile()">
              <mat-icon>folder_open</mat-icon>
              Browse
            </button>
            <button
              mat-stroked-button
              [disabled]="restoring() || !formData.backupPath"
              (click)="loadBackupInfo()"
              matTooltip="Read backup file information"
            >
              <mat-icon>info</mat-icon>
              Read
            </button>
          </div>
        </div>

        <!-- Backup Info -->
        @if (backupInfo()) {
          <div class="backup-info-section">
            <div class="info-grid">
              <div class="info-item">
                <span class="label">Database:</span>
                <span class="value">{{ backupInfo()!.databaseName }}</span>
              </div>
              <div class="info-item">
                <span class="label">Type:</span>
                <span class="value">{{ backupInfo()!.backupType }}</span>
              </div>
              <div class="info-item">
                <span class="label">Backup Date:</span>
                <span class="value">{{ backupInfo()!.backupFinishDate | date: 'medium' }}</span>
              </div>
              <div class="info-item">
                <span class="label">Size:</span>
                <span class="value">{{ formatBytes(backupInfo()!.backupSizeBytes) }}</span>
              </div>
              <div class="info-item">
                <span class="label">Server:</span>
                <span class="value">{{ backupInfo()!.serverName }}</span>
              </div>
              <div class="info-item">
                <span class="label">Recovery Model:</span>
                <span class="value">{{ backupInfo()!.recoveryModel }}</span>
              </div>
            </div>
          </div>
        }

        @if (loadingInfo()) {
          <div class="loading-info">
            <mat-progress-bar mode="indeterminate" />
            <span>Reading backup file information...</span>
          </div>
        }

        <!-- Destination -->
        <div class="section">
          <h3>Destination</h3>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Restore As Database</mat-label>
            <input
              matInput
              [(ngModel)]="formData.targetDatabase"
              [disabled]="restoring()"
              placeholder="Enter target database name"
            />
            <mat-hint>Leave empty to use original database name from backup</mat-hint>
          </mat-form-field>
        </div>

        <!-- File Relocations -->
        @if (backupInfo()?.files?.length) {
          <mat-expansion-panel class="files-panel">
            <mat-expansion-panel-header>
              <mat-panel-title>
                <mat-icon>folder_copy</mat-icon>
                File Relocations ({{ backupInfo()!.files!.length }} files)
              </mat-panel-title>
            </mat-expansion-panel-header>
            <div class="files-list">
              @for (file of backupInfo()!.files; track file.logicalName; let i = $index) {
                <div class="file-item">
                  <div class="file-header">
                    <mat-icon>{{
                      file.fileType === 'D' ? 'description' : 'receipt_long'
                    }}</mat-icon>
                    <span class="logical-name">{{ file.logicalName }}</span>
                    <span class="file-type">{{ file.fileType === 'D' ? 'Data' : 'Log' }}</span>
                  </div>
                  <div class="file-paths">
                    <div class="original-path">
                      <span class="path-label">Original:</span>
                      <span class="path-value">{{ file.physicalName }}</span>
                    </div>
                    <div class="new-path">
                      <mat-form-field appearance="outline" class="full-width">
                        <mat-label>Restore To</mat-label>
                        <input
                          matInput
                          [(ngModel)]="fileRelocations[i].newPath"
                          [disabled]="restoring()"
                        />
                      </mat-form-field>
                      <button
                        mat-icon-button
                        [disabled]="restoring()"
                        (click)="browseFilePath(i)"
                        matTooltip="Browse for location"
                      >
                        <mat-icon>folder_open</mat-icon>
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>
          </mat-expansion-panel>
        }

        <!-- Options -->
        <div class="section">
          <h3>Options</h3>
          <div class="options-row">
            <mat-checkbox [(ngModel)]="formData.withReplace" [disabled]="restoring()">
              WITH REPLACE
              <mat-icon class="help-icon" matTooltip="Overwrite existing database without prompting"
                >help_outline</mat-icon
              >
            </mat-checkbox>
            <mat-checkbox [(ngModel)]="formData.withRecovery" [disabled]="restoring()">
              WITH RECOVERY
              <mat-icon
                class="help-icon"
                matTooltip="Make database operational after restore (default)"
                >help_outline</mat-icon
              >
            </mat-checkbox>
            <mat-checkbox
              [(ngModel)]="formData.withNoRecovery"
              [disabled]="restoring() || formData.withRecovery"
            >
              WITH NORECOVERY
              <mat-icon
                class="help-icon"
                matTooltip="Leave database in restoring state for additional restores"
                >help_outline</mat-icon
              >
            </mat-checkbox>
          </div>
          <div class="options-row">
            <mat-checkbox [(ngModel)]="formData.withStats" [disabled]="restoring()">
              Show Progress (WITH STATS)
            </mat-checkbox>
            <mat-checkbox [(ngModel)]="formData.withChecksum" [disabled]="restoring()">
              Verify Checksum
            </mat-checkbox>
          </div>
        </div>

        <!-- T-SQL Preview -->
        <mat-expansion-panel class="tsql-panel">
          <mat-expansion-panel-header>
            <mat-panel-title>
              <mat-icon>code</mat-icon>
              T-SQL Command
            </mat-panel-title>
          </mat-expansion-panel-header>
          <pre class="tsql-code">{{ generatedTsql() }}</pre>
        </mat-expansion-panel>

        <!-- Progress -->
        @if (restoring()) {
          <div class="progress-section">
            <div class="progress-header">
              <span>{{ progress()?.currentPhase || 'Restoring...' }}</span>
              <span>{{ progress()?.percentComplete || 0 }}%</span>
            </div>
            <mat-progress-bar mode="determinate" [value]="progress()?.percentComplete || 0" />
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()" [disabled]="restoring()">Cancel</button>
        <button
          mat-flat-button
          color="primary"
          [disabled]="!canRestore() || restoring()"
          (click)="startRestore()"
        >
          @if (restoring()) {
            <mat-icon class="spinning">sync</mat-icon>
            Restoring...
          } @else {
            <mat-icon>restore</mat-icon>
            Start Restore
          }
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .restore-dialog {
        min-width: 600px;
        max-width: 750px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);

        mat-icon {
          color: var(--status-warning);
        }
      }

      .section {
        margin-bottom: var(--spacing-lg);

        h3 {
          font-size: var(--font-size-sm);
          font-weight: 500;
          color: var(--text-secondary);
          margin-bottom: var(--spacing-sm);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
      }

      .full-width {
        width: 100%;
      }

      .path-row {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-start;

        .flex-1 {
          flex: 1;
        }

        button {
          margin-top: 4px;
        }
      }

      .backup-info-section {
        padding: var(--spacing-md);
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);
        border-left: 3px solid var(--status-info);
      }

      .info-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-sm) var(--spacing-lg);
      }

      .info-item {
        display: flex;
        gap: var(--spacing-sm);

        .label {
          color: var(--text-secondary);
          font-size: var(--font-size-sm);
        }

        .value {
          font-weight: 500;
        }
      }

      .loading-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-lg);
        color: var(--text-secondary);

        mat-progress-bar {
          width: 200px;
        }
      }

      .options-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-sm);

        mat-checkbox {
          display: flex;
          align-items: center;
        }

        .help-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          margin-left: 4px;
          color: var(--text-muted);
          cursor: help;
        }
      }

      .files-panel,
      .tsql-panel {
        margin-top: var(--spacing-md);
        background-color: var(--bg-secondary);

        mat-panel-title {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }
      }

      .files-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .file-item {
        padding: var(--spacing-sm);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
      }

      .file-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);

        mat-icon {
          color: var(--text-muted);
        }

        .logical-name {
          font-weight: 500;
          flex: 1;
        }

        .file-type {
          font-size: var(--font-size-xs);
          padding: 2px 6px;
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          color: var(--text-secondary);
        }
      }

      .file-paths {
        padding-left: 28px;
      }

      .original-path {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        margin-bottom: var(--spacing-xs);
        font-family: var(--font-mono);

        .path-label {
          margin-right: var(--spacing-xs);
        }
      }

      .new-path {
        display: flex;
        gap: var(--spacing-xs);
        align-items: flex-start;

        mat-form-field {
          flex: 1;
        }

        button {
          margin-top: 4px;
        }
      }

      .tsql-code {
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        padding: var(--spacing-md);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        overflow-x: auto;
        margin: 0;
        white-space: pre-wrap;
      }

      .progress-section {
        margin: var(--spacing-md) 0;
        padding: var(--spacing-md);
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);

        .progress-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: var(--spacing-xs);
          font-size: var(--font-size-sm);
        }
      }

      .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class RestoreDialogComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  readonly dialogRef = inject(MatDialogRef<RestoreDialogComponent>);
  readonly data: RestoreDialogData = inject(MAT_DIALOG_DATA);

  private progressSubscription?: Subscription;

  formData = {
    backupPath: '',
    targetDatabase: '',
    withReplace: false,
    withRecovery: true,
    withNoRecovery: false,
    withStats: true,
    withChecksum: true,
  };

  fileRelocations: { logicalName: string; newPath: string }[] = [];

  readonly restoring = signal(false);
  readonly loadingInfo = signal(false);
  readonly progress = signal<RestoreProgress | null>(null);
  readonly backupInfo = signal<BackupFileInfo | null>(null);

  readonly generatedTsql = computed(() => {
    const path = this.formData.backupPath || '<backup_path>';
    const db = this.formData.targetDatabase || this.backupInfo()?.databaseName || '<database>';

    let sql = `RESTORE DATABASE [${db}]\nFROM DISK = N'${path}'`;

    const withOptions: string[] = [];

    // File relocations
    if (this.fileRelocations.length > 0) {
      this.fileRelocations.forEach(f => {
        if (f.newPath) {
          withOptions.push(`MOVE N'${f.logicalName}' TO N'${f.newPath}'`);
        }
      });
    }

    // Recovery options
    if (this.formData.withNoRecovery) {
      withOptions.push('NORECOVERY');
    } else if (this.formData.withRecovery) {
      withOptions.push('RECOVERY');
    }

    if (this.formData.withReplace) {
      withOptions.push('REPLACE');
    }

    if (this.formData.withChecksum) {
      withOptions.push('CHECKSUM');
    }

    if (this.formData.withStats) {
      withOptions.push('STATS = 10');
    }

    if (withOptions.length > 0) {
      sql += '\nWITH ' + withOptions.join(',\n     ');
    }

    return sql + ';';
  });

  ngOnInit(): void {
    // Pre-fill target database if provided
    if (this.data.databaseName) {
      this.formData.targetDatabase = this.data.databaseName;
    }

    // Subscribe to progress updates
    this.progressSubscription = this.ipc.getRestoreProgress().subscribe(p => {
      this.progress.set(p);
      if (p.status === 'completed') {
        this.restoring.set(false);
        this.notification.success('Database restored successfully');
        this.dialogRef.close({
          success: true,
          database: this.formData.targetDatabase || this.backupInfo()?.databaseName,
        });
      } else if (p.status === 'failed') {
        this.restoring.set(false);
        this.notification.error(p.error || 'Restore failed');
      }
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
  }

  onBackupPathChange(): void {
    // Clear backup info when path changes
    this.backupInfo.set(null);
    this.fileRelocations = [];
  }

  browseBackupFile(): void {
    const dialogData: ServerFileBrowserDialogData = {
      connectionId: this.data.connectionId,
      title: 'Select Backup File',
      mode: 'open',
      initialPath: this.getDirectoryFromPath(this.formData.backupPath),
      fileFilter: '.bak',
    };

    const dialogRef = this.dialog.open(ServerFileBrowserComponent, {
      data: dialogData,
      width: '600px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.path) {
        this.formData.backupPath = result.path;
        this.loadBackupInfo();
      }
    });
  }

  browseFilePath(index: number): void {
    const file = this.backupInfo()?.files?.[index];
    if (!file) return;

    const dialogData: ServerFileBrowserDialogData = {
      connectionId: this.data.connectionId,
      title: `Select Location for ${file.logicalName}`,
      mode: 'save',
      initialPath: this.getDirectoryFromPath(
        this.fileRelocations[index]?.newPath || file.physicalName
      ),
      fileFilter: file.fileType === 'D' ? '.mdf' : '.ldf',
      defaultFileName: this.getFileNameFromPath(file.physicalName),
    };

    const dialogRef = this.dialog.open(ServerFileBrowserComponent, {
      data: dialogData,
      width: '600px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.path) {
        this.fileRelocations[index].newPath = result.path;
      }
    });
  }

  async loadBackupInfo(): Promise<void> {
    if (!this.formData.backupPath) return;

    this.loadingInfo.set(true);
    try {
      const info = await this.ipc
        .getBackupInfo(this.data.connectionId, this.formData.backupPath)
        .toPromise();

      if (info) {
        this.backupInfo.set(info);

        // Initialize file relocations
        if (info.files) {
          this.fileRelocations = info.files.map(f => ({
            logicalName: f.logicalName,
            newPath: f.physicalName, // Default to original path
          }));
        }

        // Pre-fill target database if not already set
        if (!this.formData.targetDatabase && info.databaseName) {
          this.formData.targetDatabase = info.databaseName;
        }
      }
    } catch (error) {
      this.notification.error(
        error instanceof Error ? error.message : 'Failed to read backup file'
      );
    } finally {
      this.loadingInfo.set(false);
    }
  }

  private getDirectoryFromPath(path: string): string {
    if (!path) return '';
    const lastSlash = path.lastIndexOf('\\');
    return lastSlash > 0 ? path.substring(0, lastSlash) : path;
  }

  private getFileNameFromPath(path: string): string {
    if (!path) return '';
    const lastSlash = path.lastIndexOf('\\');
    return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
  }

  canRestore(): boolean {
    return !!this.formData.backupPath.trim();
  }

  async startRestore(): Promise<void> {
    if (!this.canRestore()) return;

    this.restoring.set(true);
    this.progress.set({
      restoreId: `restore-${Date.now()}`,
      status: 'starting',
      percentComplete: 0,
    });

    // Build file relocations for request
    const relocations: FileRelocation[] = this.fileRelocations
      .filter(
        f =>
          f.newPath !==
          this.backupInfo()?.files?.find(bf => bf.logicalName === f.logicalName)?.physicalName
      )
      .map(
        f =>
          ({
            logicalName: f.logicalName,
            physicalName: f.newPath,
          }) as FileRelocation
      );

    const request: RestoreRequest = {
      connectionId: this.data.connectionId,
      backupPath: this.formData.backupPath,
      targetDatabase: this.formData.targetDatabase || undefined,
      withReplace: this.formData.withReplace,
      withRecovery: this.formData.withRecovery,
      withNoRecovery: this.formData.withNoRecovery,
      fileRelocations: relocations.length > 0 ? relocations : undefined,
    };

    try {
      await this.ipc.startRestore(request).toPromise();
    } catch (error) {
      this.restoring.set(false);
      this.notification.error(error instanceof Error ? error.message : 'Failed to start restore');
    }
  }

  cancel(): void {
    if (this.restoring()) {
      const restoreId = this.progress()?.restoreId;
      if (restoreId) {
        this.ipc.cancelRestore(restoreId).toPromise();
      }
    }
    this.dialogRef.close();
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}
