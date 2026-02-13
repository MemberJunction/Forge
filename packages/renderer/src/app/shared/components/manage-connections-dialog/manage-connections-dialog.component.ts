/**
 * Manage Connections Dialog Component
 * Modal dialog for reordering, editing, and deleting saved connections
 */

import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ConnectionStateService } from '../../../core/state/connection.state';
import {
  ConnectionDialogComponent,
  ConnectionDialogData,
} from '../connection-dialog/connection-dialog.component';
import type { ConnectionProfile } from '@mj-forge/shared';

@Component({
  selector: 'app-manage-connections-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatDividerModule,
    DragDropModule,
  ],
  template: `
    <div class="manage-connections-dialog">
      <h2 mat-dialog-title>
        <mat-icon>settings</mat-icon>
        <span>Manage Connections</span>
      </h2>

      <mat-dialog-content>
        @if (connections().length === 0) {
          <div class="empty-state">
            <mat-icon>cloud_off</mat-icon>
            <p>No saved connections</p>
            <button mat-stroked-button (click)="addConnection()">
              <mat-icon>add</mat-icon>
              Add Connection
            </button>
          </div>
        } @else {
          <p class="hint">Drag to reorder. Connections appear in this order in the dropdown.</p>
          <div cdkDropList (cdkDropListDropped)="onDrop($event)" class="connection-list">
            @for (conn of connections(); track conn.id) {
              <div class="connection-item" cdkDrag>
                <div class="drag-placeholder" *cdkDragPlaceholder></div>
                <mat-icon class="drag-handle" cdkDragHandle>drag_indicator</mat-icon>
                <div class="connection-info">
                  <span class="connection-name">{{ conn.name }}</span>
                  <span class="connection-detail">{{ conn.server }}:{{ conn.port }}</span>
                </div>
                @if (conn.id === connectionState.activeConnectionId()) {
                  <span class="active-badge">Connected</span>
                }
                <div class="connection-actions">
                  <button mat-icon-button matTooltip="Edit" (click)="editConnection(conn)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button
                    mat-icon-button
                    matTooltip="Delete"
                    (click)="deleteConnection(conn)"
                    [disabled]="deleting() === conn.id"
                  >
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>
            }
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-stroked-button (click)="addConnection()">
          <mat-icon>add</mat-icon>
          New Connection
        </button>
        <button mat-flat-button color="primary" (click)="close()">Done</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .manage-connections-dialog {
        width: 520px;
      }

      h2[mat-dialog-title] {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 0;

        mat-icon {
          color: var(--text-secondary);
        }
      }

      mat-dialog-content {
        padding-top: 8px;
        min-height: 120px;
        max-height: 400px;
      }

      .hint {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        margin: 0 0 12px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 16px;
        color: var(--text-muted);
        text-align: center;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: 12px;
          opacity: 0.5;
        }

        p {
          margin-bottom: 16px;
        }
      }

      .connection-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .connection-item {
        display: flex;
        align-items: center;
        padding: 8px 8px 8px 4px;
        border-radius: 6px;
        background: var(--bg-primary);
        border: 1px solid var(--border-primary);
        cursor: default;
        transition: box-shadow 0.15s ease;

        &:hover {
          background: var(--bg-hover);
        }
      }

      .connection-item.cdk-drag-preview {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        border-color: var(--accent-primary);
      }

      .drag-placeholder {
        height: 52px;
        border: 2px dashed var(--border-primary);
        border-radius: 6px;
        background: var(--bg-hover);
        opacity: 0.5;
      }

      .cdk-drop-list-dragging .connection-item:not(.cdk-drag-placeholder) {
        transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
      }

      .drag-handle {
        cursor: grab;
        color: var(--text-muted);
        font-size: 18px;
        width: 18px;
        height: 18px;
        margin-right: 8px;
        flex-shrink: 0;

        &:active {
          cursor: grabbing;
        }
      }

      .connection-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .connection-name {
        font-weight: 500;
        font-size: var(--font-size-sm);
        color: var(--text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .connection-detail {
        font-size: 11px;
        color: var(--text-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .active-badge {
        font-size: 11px;
        font-weight: 500;
        color: var(--status-success);
        background: rgba(76, 175, 80, 0.12);
        padding: 2px 8px;
        border-radius: 10px;
        margin-right: 4px;
        white-space: nowrap;
      }

      .connection-actions {
        display: flex;
        gap: 0;
        flex-shrink: 0;

        button {
          width: 32px;
          height: 32px;

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }
      }

      mat-dialog-actions {
        padding: 16px 24px;
        gap: 8px;

        button mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          margin-right: 4px;
        }
      }
    `,
  ],
})
export class ManageConnectionsDialogComponent {
  readonly connectionState = inject(ConnectionStateService);
  private readonly dialogRef = inject(MatDialogRef<ManageConnectionsDialogComponent>);
  private readonly dialog = inject(MatDialog);

  readonly connections = signal<ConnectionProfile[]>([]);
  readonly deleting = signal<string | null>(null);

  constructor() {
    this.connections.set([...this.connectionState.profiles()]);
  }

  async onDrop(event: CdkDragDrop<ConnectionProfile[]>): Promise<void> {
    const items = [...this.connections()];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    this.connections.set(items);
    await this.connectionState.reorderProfiles(items.map(p => p.id));
  }

  addConnection(): void {
    const ref = this.dialog.open(ConnectionDialogComponent, {
      data: {} as ConnectionDialogData,
      width: '540px',
    });

    ref.afterClosed().subscribe(() => {
      // Refresh the list after adding
      this.connections.set([...this.connectionState.profiles()]);
    });
  }

  editConnection(profile: ConnectionProfile): void {
    const ref = this.dialog.open(ConnectionDialogComponent, {
      data: { profile } as ConnectionDialogData,
      width: '540px',
    });

    ref.afterClosed().subscribe(() => {
      // Refresh the list after editing
      this.connections.set([...this.connectionState.profiles()]);
    });
  }

  async deleteConnection(profile: ConnectionProfile): Promise<void> {
    this.deleting.set(profile.id);
    try {
      const success = await this.connectionState.deleteProfile(profile.id);
      if (success) {
        this.connections.set([...this.connectionState.profiles()]);
      }
    } finally {
      this.deleting.set(null);
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
