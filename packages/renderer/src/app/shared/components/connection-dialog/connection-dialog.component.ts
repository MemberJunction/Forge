/**
 * Connection Dialog Component
 * Modal dialog for creating or editing a database connection
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionStateService } from '../../../core/state/connection.state';
import { ExplorerStateService } from '../../../core/state/explorer.state';
import type { ConnectionProfile, AuthenticationType } from '@mj-forge/shared';

export interface ConnectionDialogData {
  /** Profile to edit, or undefined for new connection */
  profile?: ConnectionProfile;
  /** Pre-fill server (e.g., from Docker container) */
  server?: string;
  /** Pre-fill port */
  port?: number;
}

export interface ConnectionDialogResult {
  /** The saved/connected profile */
  profile: ConnectionProfile;
  /** Whether connection was established */
  connected: boolean;
}

@Component({
  selector: 'app-connection-dialog',
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
    MatProgressSpinnerModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="connection-dialog">
      <h2 mat-dialog-title>
        <mat-icon>dns</mat-icon>
        <span>{{ isEditing() ? 'Edit Connection' : 'New Connection' }}</span>
      </h2>

      <mat-dialog-content>
        <!-- Database Engine -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Database Engine</mat-label>
          <mat-select [(ngModel)]="formData.engine" (ngModelChange)="onEngineChange($event)">
            <mat-option value="mssql">SQL Server</mat-option>
            <mat-option value="postgresql">PostgreSQL</mat-option>
            <mat-option value="mysql" disabled>MySQL (coming soon)</mat-option>
          </mat-select>
        </mat-form-field>

        <!-- Connection Name -->
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Connection Name</mat-label>
          <input matInput [(ngModel)]="formData.name" placeholder="My SQL Server" />
          <mat-hint>A friendly name for this connection</mat-hint>
        </mat-form-field>

        <!-- Server -->
        <div class="form-row">
          <mat-form-field appearance="outline" class="flex-2">
            <mat-label>Server</mat-label>
            <input matInput [(ngModel)]="formData.server" placeholder="localhost or hostname" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Port</mat-label>
            <input matInput type="number" [(ngModel)]="formData.port" placeholder="1433" />
          </mat-form-field>
        </div>

        <mat-divider />

        <!-- Authentication -->
        <h3>Authentication</h3>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Authentication Type</mat-label>
          <mat-select [(ngModel)]="formData.authenticationType">
            <mat-option value="sql">SQL Server Authentication</mat-option>
            <mat-option value="windows">Windows Authentication</mat-option>
            <mat-option value="azure-ad">Azure AD Authentication</mat-option>
          </mat-select>
        </mat-form-field>

        @if (formData.authenticationType === 'sql') {
          <div class="form-row">
            <mat-form-field appearance="outline" class="flex-1">
              <mat-label>Username</mat-label>
              <input matInput [(ngModel)]="formData.username" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="flex-1">
              <mat-label>Password</mat-label>
              <input matInput type="password" [(ngModel)]="formData.password" />
            </mat-form-field>
          </div>
        }

        <mat-divider />

        <!-- Color -->
        <h3>Color Tag</h3>
        <div class="color-picker-row">
          @for (c of presetColors; track c.value) {
            <button
              type="button"
              class="color-circle"
              [style.background]="c.value"
              [class.selected]="formData.color === c.value"
              [matTooltip]="c.label"
              (click)="selectColor(c.value)"
            ></button>
          }
          <button
            type="button"
            class="color-circle color-none"
            [class.selected]="!formData.color"
            matTooltip="No color"
            (click)="selectColor(undefined)"
          >
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <mat-divider />

        <!-- Options -->
        <h3>Options</h3>
        <div class="checkbox-row">
          <mat-checkbox [(ngModel)]="formData.encrypt">Encrypt Connection</mat-checkbox>
          <mat-checkbox [(ngModel)]="formData.trustServerCertificate">
            Trust Server Certificate
          </mat-checkbox>
        </div>

        <div class="form-row">
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Connection Timeout (seconds)</mat-label>
            <input matInput type="number" [(ngModel)]="formData.connectionTimeout" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="flex-1">
            <mat-label>Default Database</mat-label>
            <input matInput [(ngModel)]="formData.database" placeholder="master" />
          </mat-form-field>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="start">
        <button
          mat-flat-button
          color="primary"
          [disabled]="!isValid() || connectionState.connecting() || saving()"
          (click)="connectNow()"
        >
          @if (connectionState.connecting()) {
            <mat-spinner diameter="18" />
          } @else {
            Connect
          }
        </button>
        <button
          mat-stroked-button
          color="primary"
          [disabled]="!isValid() || saving()"
          (click)="saveConnection()"
        >
          @if (saving()) {
            <mat-spinner diameter="18" />
          } @else {
            Save
          }
        </button>
        <button
          mat-stroked-button
          [disabled]="!canTestConnection() || testing()"
          (click)="testConnection()"
        >
          @if (testing()) {
            <mat-spinner diameter="18" />
          } @else {
            Test
          }
        </button>
        <button mat-button (click)="cancel()" [disabled]="saving()">Cancel</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .connection-dialog {
        width: 520px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 10px;

        mat-icon {
          color: var(--status-info);
          font-size: 22px;
          width: 22px;
          height: 22px;
        }

        span {
          font-size: 15px;
          font-weight: 600;
        }
      }

      mat-dialog-content {
        padding-top: 12px !important;
        overflow-y: auto;
        max-height: calc(80vh - 160px) !important;

        h3 {
          font-size: var(--font-size-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 12px 0 12px;
          color: var(--text-secondary);
        }
      }

      .full-width {
        width: 100%;
        margin-bottom: 8px;
      }

      .form-row {
        display: flex;
        gap: 12px;
        margin-bottom: 8px;
      }

      .flex-1 {
        flex: 1;
      }

      .flex-2 {
        flex: 2;
      }

      .checkbox-row {
        display: flex;
        gap: 24px;
        margin-bottom: 16px;
      }

      .color-picker-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
      }

      .color-circle {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
        transition: transform 0.12s ease, border-color 0.12s ease;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          transform: scale(1.15);
        }

        &.selected {
          border-color: var(--text-primary);
          transform: scale(1.15);
        }
      }

      .color-none {
        background: var(--bg-tertiary) !important;
        border: 2px dashed var(--border-secondary);

        mat-icon {
          font-size: 12px;
          width: 12px;
          height: 12px;
          color: var(--text-muted);
        }

        &.selected {
          border-color: var(--text-primary);
          border-style: solid;
        }
      }

      mat-divider {
        margin: 8px 0 !important;
      }

      mat-dialog-actions {
        margin: 0 !important;
        padding: 12px 24px !important;

        button mat-spinner {
          display: inline-block;
        }
      }
    `,
  ],
})
export class ConnectionDialogComponent {
  readonly connectionState = inject(ConnectionStateService);
  private readonly explorerState = inject(ExplorerStateService);
  readonly dialogRef = inject(MatDialogRef<ConnectionDialogComponent>);
  readonly data: ConnectionDialogData = inject(MAT_DIALOG_DATA) || {};

  readonly isEditing = signal(false);
  readonly testing = signal(false);
  readonly saving = signal(false);

  readonly presetColors = [
    { value: '#e53935', label: 'Red' },
    { value: '#fb8c00', label: 'Orange' },
    { value: '#fdd835', label: 'Yellow' },
    { value: '#43a047', label: 'Green' },
    { value: '#00897b', label: 'Teal' },
    { value: '#1e88e5', label: 'Blue' },
    { value: '#8e24aa', label: 'Purple' },
    { value: '#d81b60', label: 'Pink' },
  ];

  formData: Partial<ConnectionProfile> & { password?: string } = {
    name: '',
    engine: 'mssql',
    server: 'localhost',
    port: 1433,
    authenticationType: 'sql',
    username: 'sa',
    password: '',
    encrypt: true,
    trustServerCertificate: true,
    connectionTimeout: 30,
    database: '',
    color: undefined,
  };

  constructor() {
    // Initialize from dialog data
    if (this.data.profile) {
      this.isEditing.set(true);
      this.formData = {
        ...this.data.profile,
        password: '', // Don't show stored password
      };
    } else {
      // Apply pre-fill values
      if (this.data.server) {
        this.formData.server = this.data.server;
      }
      if (this.data.port) {
        this.formData.port = this.data.port;
      }
    }
  }

  selectColor(color: string | undefined): void {
    this.formData.color = color;
  }

  async testConnection(): Promise<void> {
    if (!this.canTestConnection()) return;

    this.testing.set(true);
    try {
      const profile = this.buildTestProfile();
      await this.connectionState.testConnection(profile, this.formData.password);
    } finally {
      this.testing.set(false);
    }
  }

  async saveConnection(): Promise<void> {
    if (!this.isValid() || this.saving()) return;

    this.saving.set(true);
    try {
      const profile = this.buildProfile();
      const savedProfile = await this.connectionState.saveProfile(profile, this.formData.password);
      if (savedProfile) {
        this.dialogRef.close({ profile: savedProfile, connected: false } as ConnectionDialogResult);
      }
    } finally {
      this.saving.set(false);
    }
  }

  async connectNow(): Promise<void> {
    if (!this.isValid() || this.saving() || this.connectionState.connecting()) return;

    this.saving.set(true);
    const profile = this.buildProfile();
    const savedProfile = await this.connectionState.saveProfile(profile, this.formData.password);

    if (!savedProfile) {
      this.saving.set(false);
      return;
    }

    this.saving.set(false);

    const success = await this.connectionState.connect(savedProfile.id);
    if (success) {
      this.explorerState.addServerNode(savedProfile.id, savedProfile.name);
      this.explorerState.expandNode(`server-${savedProfile.id}`);
      this.dialogRef.close({ profile: savedProfile, connected: true } as ConnectionDialogResult);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  isValid(): boolean {
    return !!(
      this.formData.name &&
      this.formData.server &&
      this.formData.port &&
      (this.formData.authenticationType !== 'sql' || this.formData.username)
    );
  }

  onEngineChange(engine: string): void {
    const ports: Record<string, number> = { mssql: 1433, postgresql: 5432, mysql: 3306 };
    this.formData.port = ports[engine] || 1433;
    // Adjust default username for engine
    if (engine === 'postgresql' && (!this.formData.username || this.formData.username === 'sa')) {
      this.formData.username = 'postgres';
    } else if (engine === 'mssql' && (!this.formData.username || this.formData.username === 'postgres')) {
      this.formData.username = 'sa';
    }
    // PG/MySQL don't support Windows auth
    if (engine !== 'mssql' && this.formData.authenticationType !== 'sql') {
      this.formData.authenticationType = 'sql';
    }
  }

  canTestConnection(): boolean {
    return !!(
      this.formData.server &&
      this.formData.port &&
      (this.formData.authenticationType !== 'sql' || this.formData.username)
    );
  }

  private buildTestProfile(): ConnectionProfile {
    return {
      id: 'test-connection',
      name: this.formData.name || 'Test Connection',
      engine: this.formData.engine || 'mssql',
      server: this.formData.server!,
      port: this.formData.port!,
      authenticationType: this.formData.authenticationType as AuthenticationType,
      username: this.formData.username,
      database: this.formData.database || undefined,
      encrypt: this.formData.encrypt ?? true,
      trustServerCertificate: this.formData.trustServerCertificate ?? true,
      connectionTimeout: this.formData.connectionTimeout || 30,
      color: this.formData.color,
    };
  }

  private buildProfile(): Partial<ConnectionProfile> & { id?: string } {
    const existingId = this.data.profile?.id;

    return {
      ...(existingId ? { id: existingId } : {}),
      name: this.formData.name!,
      engine: this.formData.engine || 'mssql',
      server: this.formData.server!,
      port: this.formData.port!,
      authenticationType: this.formData.authenticationType as AuthenticationType,
      username: this.formData.username,
      database: this.formData.database || undefined,
      encrypt: this.formData.encrypt ?? true,
      trustServerCertificate: this.formData.trustServerCertificate ?? true,
      connectionTimeout: this.formData.connectionTimeout || 30,
      color: this.formData.color,
    };
  }
}
