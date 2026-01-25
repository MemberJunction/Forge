/**
 * Backup Database Dialog Component
 * Modal dialog for backing up a database with server-side file browsing
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
import { Subscription } from 'rxjs';
import { IpcService } from '../../../core/services/ipc.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  ServerFileBrowserComponent,
  ServerFileBrowserDialogData,
} from '../server-file-browser/server-file-browser.component';
import type {
  BackupRequest,
  BackupType,
  BackupProgress,
  BackupHistoryEntry,
} from '@mj-forge/shared';

export interface BackupDialogData {
  connectionId: string;
  databaseName: string;
}

@Component({
  selector: 'app-backup-dialog',
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
  ],
  template: `
    <div class="backup-dialog">
      <h2 mat-dialog-title>
        <mat-icon>backup</mat-icon>
        Backup Database
      </h2>

      <mat-dialog-content>
        <!-- Database Info -->
        <div class="info-row">
          <span class="label">Database:</span>
          <span class="value">{{ data.databaseName }}</span>
        </div>

        <!-- Backup Type -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Backup Type</mat-label>
          <mat-select [(ngModel)]="formData.backupType" [disabled]="backing()">
            <mat-option value="full">
              <mat-icon>save</mat-icon>
              Full Backup
            </mat-option>
            <mat-option value="differential">
              <mat-icon>difference</mat-icon>
              Differential Backup
            </mat-option>
            <mat-option value="log">
              <mat-icon>receipt_long</mat-icon>
              Transaction Log Backup
            </mat-option>
          </mat-select>
        </mat-form-field>

        <!-- Backup Path -->
        <div class="path-row">
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Backup File Path (on SQL Server)</mat-label>
            <input
              matInput
              [(ngModel)]="formData.backupPath"
              [disabled]="backing()"
              placeholder="e.g., D:\\Backups\\MyDatabase.bak"
            />
          </mat-form-field>
          <button mat-stroked-button [disabled]="backing()" (click)="browseBackupPath()">
            <mat-icon>folder_open</mat-icon>
            Browse
          </button>
        </div>

        <!-- Description -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Description (optional)</mat-label>
          <textarea
            matInput
            [(ngModel)]="formData.description"
            [disabled]="backing()"
            rows="2"
            placeholder="Backup description..."
          ></textarea>
        </mat-form-field>

        <!-- Options -->
        <div class="options-row">
          <mat-checkbox [(ngModel)]="formData.compression" [disabled]="backing()">
            Use Compression
          </mat-checkbox>
          <mat-checkbox [(ngModel)]="formData.copyOnly" [disabled]="backing()">
            Copy-Only Backup
          </mat-checkbox>
          <mat-checkbox [(ngModel)]="formData.checksum" [disabled]="backing()">
            Perform Checksum
          </mat-checkbox>
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
        @if (backing()) {
          <div class="progress-section">
            <div class="progress-header">
              <span>{{ progress()?.currentPhase || 'Backing up...' }}</span>
              <span>{{ progress()?.percentComplete || 0 }}%</span>
            </div>
            <mat-progress-bar mode="determinate" [value]="progress()?.percentComplete || 0" />
          </div>
        }

        <!-- Backup History -->
        <mat-expansion-panel class="history-panel">
          <mat-expansion-panel-header>
            <mat-panel-title>
              <mat-icon>history</mat-icon>
              Backup History
            </mat-panel-title>
          </mat-expansion-panel-header>
          <div class="history-list">
            @if (loadingHistory()) {
              <div class="loading-text">Loading history...</div>
            } @else if (backupHistory().length === 0) {
              <div class="empty-text">No backup history found</div>
            } @else {
              @for (entry of backupHistory(); track entry.backupStartDate) {
                <div class="history-item">
                  <div class="history-main">
                    <span class="history-type">{{ entry.backupType }}</span>
                    <span class="history-date">{{ entry.backupFinishDate | date: 'short' }}</span>
                  </div>
                  <div class="history-details">
                    <span class="history-path" [title]="entry.physicalDeviceName">
                      {{ entry.physicalDeviceName }}
                    </span>
                    <span class="history-size">{{ formatBytes(entry.backupSizeBytes) }}</span>
                  </div>
                </div>
              }
            }
          </div>
        </mat-expansion-panel>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()" [disabled]="backing()">Cancel</button>
        <button
          mat-flat-button
          color="primary"
          [disabled]="!canBackup() || backing()"
          (click)="startBackup()"
        >
          @if (backing()) {
            <mat-icon class="spinning">sync</mat-icon>
            Backing Up...
          } @else {
            <mat-icon>backup</mat-icon>
            Start Backup
          }
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .backup-dialog {
        min-width: 550px;
        max-width: 650px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);

        mat-icon {
          color: var(--status-info);
        }
      }

      .info-row {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-tertiary);
        border-radius: var(--radius-md);
        margin-bottom: var(--spacing-md);

        .label {
          color: var(--text-secondary);
        }

        .value {
          font-weight: 500;
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

      .options-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
        margin: var(--spacing-md) 0;
      }

      .tsql-panel,
      .history-panel {
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

      .history-list {
        max-height: 200px;
        overflow-y: auto;
      }

      .history-item {
        padding: var(--spacing-sm);
        border-bottom: 1px solid var(--border-primary);

        &:last-child {
          border-bottom: none;
        }
      }

      .history-main {
        display: flex;
        justify-content: space-between;
        margin-bottom: var(--spacing-xs);
      }

      .history-type {
        font-weight: 500;
        color: var(--status-info);
      }

      .history-date {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .history-details {
        display: flex;
        justify-content: space-between;
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }

      .history-path {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-mono);
      }

      .loading-text,
      .empty-text {
        padding: var(--spacing-md);
        text-align: center;
        color: var(--text-muted);
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
export class BackupDialogComponent implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);
  private readonly notification = inject(NotificationService);
  readonly dialogRef = inject(MatDialogRef<BackupDialogComponent>);
  readonly data: BackupDialogData = inject(MAT_DIALOG_DATA);

  private progressSubscription?: Subscription;

  formData = {
    backupType: 'full' as BackupType,
    backupPath: '',
    description: '',
    compression: true,
    copyOnly: false,
    checksum: true,
  };

  readonly backing = signal(false);
  readonly progress = signal<BackupProgress | null>(null);
  readonly backupHistory = signal<BackupHistoryEntry[]>([]);
  readonly loadingHistory = signal(false);

  readonly generatedTsql = computed(() => {
    const db = this.data.databaseName;
    const path = this.formData.backupPath || '<path>';
    const type = this.formData.backupType;

    let sql = '';
    if (type === 'full') {
      sql = `BACKUP DATABASE [${db}]\nTO DISK = N'${path}'`;
    } else if (type === 'differential') {
      sql = `BACKUP DATABASE [${db}]\nTO DISK = N'${path}'\nWITH DIFFERENTIAL`;
    } else {
      sql = `BACKUP LOG [${db}]\nTO DISK = N'${path}'`;
    }

    const options: string[] = [];
    if (this.formData.compression) options.push('COMPRESSION');
    if (this.formData.copyOnly) options.push('COPY_ONLY');
    if (this.formData.checksum) options.push('CHECKSUM');
    if (this.formData.description) {
      options.push(`DESCRIPTION = N'${this.formData.description}'`);
    }

    if (options.length > 0) {
      if (type === 'differential') {
        sql += ', ' + options.join(', ');
      } else {
        sql += '\nWITH ' + options.join(', ');
      }
    }

    return sql + ';';
  });

  ngOnInit(): void {
    // Load default backup path
    this.loadDefaultPath();

    // Load backup history
    this.loadBackupHistory();

    // Subscribe to progress updates
    this.progressSubscription = this.ipc.getBackupProgress().subscribe(p => {
      this.progress.set(p);
      if (p.status === 'completed') {
        this.backing.set(false);
        this.notification.success('Backup completed successfully');
        this.dialogRef.close({ success: true, path: this.formData.backupPath });
      } else if (p.status === 'failed') {
        this.backing.set(false);
        this.notification.error(p.error || 'Backup failed');
      }
    });
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
  }

  private async loadDefaultPath(): Promise<void> {
    try {
      const paths = await this.ipc.getServerDefaultPaths(this.data.connectionId).toPromise();
      if (paths?.backupPath) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        this.formData.backupPath = `${paths.backupPath}${this.data.databaseName}_${timestamp}.bak`;
      }
    } catch {
      // Ignore errors
    }
  }

  private async loadBackupHistory(): Promise<void> {
    this.loadingHistory.set(true);
    try {
      const history = await this.ipc
        .getBackupHistory(this.data.connectionId, this.data.databaseName)
        .toPromise();
      this.backupHistory.set(history || []);
    } catch {
      // Ignore errors
    } finally {
      this.loadingHistory.set(false);
    }
  }

  browseBackupPath(): void {
    const dialogData: ServerFileBrowserDialogData = {
      connectionId: this.data.connectionId,
      title: 'Select Backup Location',
      mode: 'save',
      initialPath: this.getDirectoryFromPath(this.formData.backupPath),
      fileFilter: '.bak',
      defaultFileName: `${this.data.databaseName}_backup.bak`,
    };

    const dialogRef = this.dialog.open(ServerFileBrowserComponent, {
      data: dialogData,
      width: '600px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.path) {
        this.formData.backupPath = result.path;
      }
    });
  }

  private getDirectoryFromPath(path: string): string {
    if (!path) return '';
    const lastSlash = path.lastIndexOf('\\');
    return lastSlash > 0 ? path.substring(0, lastSlash) : path;
  }

  canBackup(): boolean {
    return !!this.formData.backupPath.trim();
  }

  async startBackup(): Promise<void> {
    if (!this.canBackup()) return;

    this.backing.set(true);
    this.progress.set({
      backupId: `backup-${Date.now()}`,
      status: 'starting',
      percentComplete: 0,
    });

    const request: BackupRequest = {
      connectionId: this.data.connectionId,
      database: this.data.databaseName,
      backupPath: this.formData.backupPath,
      backupType: this.formData.backupType,
      compression: this.formData.compression,
      copyOnly: this.formData.copyOnly,
      checksum: this.formData.checksum,
      description: this.formData.description || undefined,
    };

    try {
      await this.ipc.startBackup(request).toPromise();
    } catch (error) {
      this.backing.set(false);
      this.notification.error(error instanceof Error ? error.message : 'Failed to start backup');
    }
  }

  cancel(): void {
    if (this.backing()) {
      // Cancel ongoing backup
      const backupId = this.progress()?.backupId;
      if (backupId) {
        this.ipc.cancelBackup(backupId).toPromise();
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
