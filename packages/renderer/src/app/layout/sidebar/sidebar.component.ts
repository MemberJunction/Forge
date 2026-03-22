import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ExplorerStateService, TreeNode } from '../../core/state/explorer.state';
import { TabStateService } from '../../core/state/tab.state';
import { ContextMenuService, ContextMenuItem } from '../../core/services/context-menu.service';
import { NotificationService } from '../../core/services/notification.service';
import { TablePropertiesService } from '../../core/services/table-properties.service';
import { firstValueFrom } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import { ConfirmDialogComponent } from '../../shared/components/dialog/confirm-dialog.component';
import { InputDialogComponent } from '../../shared/components/dialog/input-dialog.component';
import {
  BackupDialogComponent,
  BackupDialogData,
} from '../../shared/components/backup-dialog/backup-dialog.component';
import {
  RestoreDialogComponent,
  RestoreDialogData,
} from '../../shared/components/restore-dialog/restore-dialog.component';
import {
  RenameDatabaseDialogComponent,
  RenameDatabaseDialogData,
} from '../../shared/components/rename-database-dialog/rename-database-dialog.component';
import {
  CreateDatabaseDialogComponent,
  CreateDatabaseDialogData,
} from '../../shared/components/create-database-dialog/create-database-dialog.component';
import {
  ConnectionDialogComponent,
  ConnectionDialogData,
} from '../../shared/components/connection-dialog/connection-dialog.component';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    ConfirmDialogComponent,
    InputDialogComponent,
  ],
  template: `
    <div class="sidebar-container">
      <!-- Header (with padding for macOS traffic lights) -->
      <div class="sidebar-header">
        <div class="logo-area">
          <img class="app-icon" src="assets/icons/mj-logo.png" alt="MJ Forge" />
          <span class="logo">Forge</span>
        </div>
        <button mat-icon-button matTooltip="New Connection" aria-label="New Connection" (click)="openConnectionDialog()">
          <mat-icon>add</mat-icon>
        </button>
      </div>

      <!-- Connection selector -->
      @if (connectionState.hasProfiles()) {
        <div class="connection-selector">
          <button mat-button [matMenuTriggerFor]="connectionMenu" class="connection-button">
            <mat-icon>{{ connectionState.isConnected() ? 'cloud_done' : 'cloud_off' }}</mat-icon>
            <span class="connection-name">
              {{ connectionState.activeProfile()?.name || 'Select Connection' }}
            </span>
            <mat-icon class="dropdown-icon">arrow_drop_down</mat-icon>
          </button>
          <mat-menu #connectionMenu="matMenu">
            @for (profile of connectionState.profiles(); track profile.id) {
              <button
                mat-menu-item
                (click)="connectTo(profile.id)"
                [class.active]="profile.id === connectionState.activeConnectionId()"
              >
                <mat-icon>{{
                  profile.id === connectionState.activeConnectionId() ? 'check' : 'dns'
                }}</mat-icon>
                <span>{{ profile.name }}</span>
              </button>
            }
            <mat-divider />
            <button mat-menu-item (click)="openConnectionDialog()">
              <mat-icon>add</mat-icon>
              <span>New Connection</span>
            </button>
            <button mat-menu-item (click)="manageConnections()">
              <mat-icon>settings</mat-icon>
              <span>Manage Connections</span>
            </button>
          </mat-menu>
        </div>
      }

      <!-- Database selector -->
      @if (connectionState.isConnected()) {
        <div class="database-selector">
          <button
            mat-button
            [matMenuTriggerFor]="databaseMenu"
            class="database-button"
            aria-label="Select Database"
            [disabled]="connectionState.loadingDatabases()"
          >
            @if (connectionState.loadingDatabases()) {
              <mat-spinner diameter="16" />
            } @else {
              <mat-icon svgIcon="database-cylinder"></mat-icon>
            }
            <span class="database-name">
              {{ connectionState.loadingDatabases() ? 'Loading...' : (connectionState.selectedDatabase() || 'Select Database') }}
            </span>
            <mat-icon class="dropdown-icon">arrow_drop_down</mat-icon>
          </button>
          <mat-menu #databaseMenu="matMenu">
            @for (db of connectionState.databases(); track db.name) {
              <button
                mat-menu-item
                (click)="selectDatabase(db.name)"
                [class.active]="db.name === connectionState.selectedDatabase()"
              >
                @if (db.name === connectionState.selectedDatabase()) {
                  <mat-icon>check</mat-icon>
                } @else {
                  <mat-icon svgIcon="database-cylinder"></mat-icon>
                }
                <span>{{ db.name }}</span>
              </button>
            }
            <mat-divider />
            <button mat-menu-item (click)="openCreateDatabaseDialog()">
              <mat-icon>add_circle</mat-icon>
              <span>New Database...</span>
            </button>
          </mat-menu>
        </div>
      }

      <mat-divider />

      <!-- Explorer tree -->
      <div class="explorer-tree">
        @if (!connectionState.isConnected()) {
          <div class="empty-state">
            <mat-icon>cloud_off</mat-icon>
            <p>No connection</p>
            <button mat-stroked-button (click)="openConnectionDialog()">Connect to Server</button>
          </div>
        } @else if (explorerState.hasNodes()) {
          <div class="tree-container" role="tree" aria-label="Database Explorer">
            @for (node of explorerState.rootNodes(); track node.id) {
              <ng-container *ngTemplateOutlet="treeNode; context: { $implicit: node, level: 0 }" />
            }
          </div>
        } @else {
          <div class="loading-state">
            <mat-icon>hourglass_empty</mat-icon>
            <p>Loading...</p>
          </div>
        }
      </div>

      <!-- Tree node template -->
      <ng-template #treeNode let-node let-level="level">
        <div
          class="tree-item"
          role="treeitem"
          [attr.aria-expanded]="node.hasChildren ? node.isExpanded : null"
          [attr.aria-level]="level + 1"
          [attr.aria-label]="node.name + ' (' + node.type + ')'"
          [attr.aria-selected]="node.id === explorerState.selectedNodeId()"
          tabindex="0"
          [class.selected]="node.id === explorerState.selectedNodeId()"
          [style.padding-left.px]="level * 16 + 8"
          (click)="onNodeClick(node)"
          (dblclick)="onNodeDoubleClick(node)"
          (contextmenu)="onNodeRightClick(node, $event)"
          (keydown.enter)="onNodeDoubleClick(node)"
          (keydown.space)="onNodeClick(node); $event.preventDefault()"
        >
          @if (node.hasChildren) {
            <button class="expand-btn" (click)="toggleExpand(node, $event)">
              <mat-icon>{{
                node.isLoading ? 'sync' : node.isExpanded ? 'expand_more' : 'chevron_right'
              }}</mat-icon>
            </button>
          } @else {
            <span class="expand-placeholder"></span>
          }
          @if (node.icon === 'database-cylinder') {
            <mat-icon
              class="node-icon"
              [class]="'icon-' + node.type"
              svgIcon="database-cylinder"
            ></mat-icon>
          } @else {
            <mat-icon class="node-icon" [class]="'icon-' + node.type">{{ node.icon }}</mat-icon>
          }
          <span class="node-name">{{ node.name }}</span>
          @if (node.mjInfo?.isMJEnabled) {
            <img
              class="mj-icon"
              src="assets/icons/mj-logo.png"
              alt="MemberJunction"
              matTooltip="MemberJunction ({{ node.mjInfo.entityCount }} entities)"
            />
          }
        </div>
        @if (node.isExpanded && node.children) {
          @for (child of node.children; track child.id) {
            <ng-container
              *ngTemplateOutlet="treeNode; context: { $implicit: child, level: level + 1 }"
            />
          }
        }
      </ng-template>

      <!-- Quick actions -->
      <div class="quick-actions">
        <mat-divider />
        <div class="action-buttons">
          <button
            mat-icon-button
            matTooltip="New Query"
            aria-label="New Query"
            (click)="newQuery()"
            [disabled]="!connectionState.isConnected() || !connectionState.selectedDatabase()"
          >
            <mat-icon>code</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Refresh"
            aria-label="Refresh Explorer"
            (click)="refresh()"
            [disabled]="!connectionState.isConnected()"
          >
            <mat-icon>refresh</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Backup Database"
            aria-label="Backup Database"
            (click)="openBackup()"
            [disabled]="!connectionState.isConnected() || !connectionState.selectedDatabase()"
          >
            <mat-icon>backup</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Restore Database"
            aria-label="Restore Database"
            (click)="openRestore()"
            [disabled]="!connectionState.isConnected()"
          >
            <mat-icon>restore</mat-icon>
          </button>
        </div>
      </div>

      <!-- Dialogs -->
      <app-confirm-dialog #deleteDialog (confirmed)="onDeleteConfirmed()" />
      <app-input-dialog #renameDialog (confirmed)="onRenameConfirmed($event)" />
    </div>
  `,
  styles: [
    `
      .sidebar-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        padding-top: 28px; /* Space for macOS traffic lights */
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
        -webkit-app-region: drag; /* Allow dragging window from header */
      }

      .sidebar-header button {
        -webkit-app-region: no-drag; /* Buttons should be clickable */
      }

      .logo-area {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .app-icon {
        width: 28px;
        height: 28px;
        object-fit: contain;
      }

      .logo {
        font-size: 18px;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: 0.5px;
      }

      .connection-selector,
      .database-selector {
        padding: var(--spacing-xs) var(--spacing-sm);
      }

      .connection-button,
      .database-button {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        text-align: left;
        padding: var(--spacing-xs) var(--spacing-sm);
        color: var(--text-primary) !important;

        .mat-icon {
          margin-right: var(--spacing-sm);
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--text-secondary);
        }

        .connection-name,
        .database-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
          font-size: var(--font-size-sm);
        }

        .dropdown-icon {
          margin-right: 0;
          margin-left: auto;
          color: var(--text-muted);
        }
      }

      .explorer-tree {
        flex: 1;
        overflow: auto;
        padding: var(--spacing-xs) 0;
      }

      .empty-state,
      .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);
        text-align: center;

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          margin-bottom: var(--spacing-md);
          opacity: 0.5;
        }

        p {
          margin-bottom: var(--spacing-md);
        }
      }

      .tree-container {
        font-size: var(--font-size-sm);
      }

      .tree-item {
        display: flex;
        align-items: center;
        padding: 4px 8px;
        cursor: pointer;
        user-select: none;
        outline: none;

        &:hover {
          background-color: var(--bg-hover);
        }

        &.selected {
          background-color: var(--bg-active);
        }

        &:focus-visible {
          outline: 2px solid var(--status-info);
          outline-offset: -2px;
          border-radius: var(--radius-sm);
        }
      }

      .expand-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        min-width: 16px;
        height: 16px;
        padding: 0;
        margin-right: 4px;
        background: none;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:hover {
          color: var(--text-primary);
        }
      }

      .expand-placeholder {
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin-right: 4px;
      }

      .node-icon {
        font-size: 16px;
        width: 16px;
        min-width: 16px;
        height: 16px;
        margin-right: var(--spacing-xs);
        flex-shrink: 0;

        &.icon-server {
          color: var(--status-info);
        }
        &.icon-database {
          color: var(--syntax-function);
        }
        &.icon-folder {
          color: var(--syntax-string);
        }
        &.icon-table {
          color: var(--syntax-type);
        }
        &.icon-view {
          color: var(--syntax-keyword);
        }
        &.icon-procedure,
        &.icon-function {
          color: var(--syntax-function);
        }
      }

      .node-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mj-icon {
        width: 14px;
        height: 14px;
        margin-left: var(--spacing-xs);
        flex-shrink: 0;
        opacity: 0.9;
        transition: opacity var(--transition-fast);

        &:hover {
          opacity: 1;
        }
      }

      .quick-actions {
        margin-top: auto;

        .action-buttons {
          display: flex;
          justify-content: space-around;
          padding: var(--spacing-sm);
        }
      }
    `,
  ],
})
export class SidebarComponent {
  @ViewChild('deleteDialog') deleteDialog!: ConfirmDialogComponent;
  @ViewChild('renameDialog') renameDialog!: InputDialogComponent;

  readonly connectionState = inject(ConnectionStateService);
  readonly explorerState = inject(ExplorerStateService);
  private readonly tabState = inject(TabStateService);
  private readonly router = inject(Router);
  private readonly contextMenu = inject(ContextMenuService);
  private readonly notification = inject(NotificationService);
  private readonly tableProperties = inject(TablePropertiesService);
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);

  // State for pending database operations
  private pendingDeleteDatabase: string | null = null;
  private pendingRenameDatabase: string | null = null;

  openConnectionDialog(): void {
    this.dialog.open(ConnectionDialogComponent, {
      data: {} as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  manageConnections(): void {
    this.dialog.open(ConnectionDialogComponent, {
      data: {} as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  async connectTo(profileId: string): Promise<void> {
    const success = await this.connectionState.connect(profileId);
    if (success) {
      const profile = this.connectionState.getProfile(profileId);
      if (profile) {
        this.explorerState.addServerNode(profileId, profile.name);
        this.explorerState.expandNode(`server-${profileId}`);
      }
    }
  }

  selectDatabase(name: string): void {
    this.connectionState.selectDatabase(name);
  }

  onNodeClick(node: TreeNode): void {
    this.explorerState.selectNode(node.id);
    // Also toggle expansion when clicking anywhere on a folder/expandable node
    if (node.hasChildren) {
      this.explorerState.toggleNode(node.id);
    }
  }

  onNodeDoubleClick(node: TreeNode): void {
    if (node.hasChildren) {
      this.explorerState.toggleNode(node.id);
      return;
    }

    if (!node.connectionId || !node.databaseName || !node.metadata) return;

    // MJ entity: open SELECT TOP 1000 query
    if (node.type === 'mj_entity') {
      const schema = node.metadata.schema || '__mj';
      const baseTable = (node as TreeNode & { tableName?: string }).tableName || node.metadata.name;
      const sql = `SELECT TOP 1000 * FROM [${schema}].[${baseTable}]`;
      this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
      this.router.navigate(['/query']);
      return;
    }

    // MJ saved query: open query SQL in editor
    if (node.type === 'mj_query' && node.metadata.definition) {
      this.tabState.openQueryTab(node.connectionId, node.databaseName, node.metadata.definition);
      this.router.navigate(['/query']);
      return;
    }

    // Standard database objects: open object details tab
    this.tabState.openObjectTab(
      node.connectionId,
      node.databaseName,
      node.metadata.name,
      node.metadata.type,
      node.metadata.schema || node.schema || 'dbo'
    );
    this.router.navigate(['/explorer']);
  }

  toggleExpand(node: TreeNode, event: Event): void {
    event.stopPropagation();
    this.explorerState.toggleNode(node.id);
  }

  newQuery(): void {
    const connectionId = this.connectionState.activeConnectionId();
    const databaseName = this.connectionState.selectedDatabase();
    if (connectionId && databaseName) {
      this.tabState.openQueryTab(connectionId, databaseName);
      this.router.navigate(['/query']);
    }
  }

  async refresh(): Promise<void> {
    await this.connectionState.loadDatabases();
    const selectedNode = this.explorerState.selectedNodeId();
    if (selectedNode) {
      await this.explorerState.refreshNode(selectedNode);
    }
  }

  openBackup(databaseName?: string): void {
    const connectionId = this.connectionState.activeConnectionId();
    const dbName = databaseName || this.connectionState.selectedDatabase();

    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    if (!dbName) {
      this.notification.error('Please select a database first');
      return;
    }

    const dialogData: BackupDialogData = {
      connectionId,
      databaseName: dbName,
    };

    const dialogRef = this.dialog.open(BackupDialogComponent, {
      data: dialogData,
      width: '650px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success) {
        // Optionally refresh or show additional notification
      }
    });
  }

  openRestore(databaseName?: string): void {
    const connectionId = this.connectionState.activeConnectionId();

    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    const dialogData: RestoreDialogData = {
      connectionId,
      databaseName,
    };

    const dialogRef = this.dialog.open(RestoreDialogComponent, {
      data: dialogData,
      width: '750px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success) {
        // Refresh the database list after restore
        this.connectionState.loadDatabases();
        // Refresh explorer tree
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          this.explorerState.refreshNode(serverNode.id);
        }
      }
    });
  }

  onNodeRightClick(node: TreeNode, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.explorerState.selectNode(node.id);

    const items = this.getContextMenuItems(node);
    if (items.length > 0) {
      this.contextMenu.show(event, items, node);
    }
  }

  private getContextMenuItems(node: TreeNode): ContextMenuItem[] {
    switch (node.type) {
      case 'server':
        return this.getServerContextMenu(node);
      case 'database':
        return this.getDatabaseContextMenu(node);
      case 'folder':
        return this.getFolderContextMenu(node);
      case 'table':
        return this.getTableContextMenu(node);
      case 'view':
        return this.getViewContextMenu(node);
      case 'procedure':
        return this.getProcedureContextMenu(node);
      case 'function':
        return this.getFunctionContextMenu(node);
      // MJ-specific context menus
      case 'mj_entity':
        return this.getMJEntityContextMenu(node);
      case 'mj_query':
        return this.getMJQueryContextMenu(node);
      case 'mj_changes_folder':
        return this.getMJChangesFolderContextMenu(node);
      case 'mj_audit_folder':
        return this.getMJAuditFolderContextMenu(node);
      case 'mj_errors_folder':
        return this.getMJErrorsFolderContextMenu(node);
      default:
        return [];
    }
  }

  private getServerContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'new-query',
        label: 'New Query',
        icon: 'code',
        action: () => {
          if (node.connectionId) {
            this.tabState.openQueryTab(node.connectionId, 'master');
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'new-database',
        label: 'New Database...',
        icon: 'add_circle',
        action: () => {
          if (node.connectionId) {
            this._openCreateDatabaseDialog(node.connectionId);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'disconnect',
        label: 'Disconnect',
        icon: 'power_off',
        action: async () => {
          if (node.connectionId) {
            await this.connectionState.disconnect();
            this.explorerState.removeServerNode(node.connectionId);
          }
        },
      },
    ];
  }

  private getDatabaseContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'new-query',
        label: 'New Query',
        icon: 'code',
        shortcut: 'Ctrl+N',
        action: () => {
          if (node.connectionId && node.databaseName) {
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName);
            this.router.navigate(['/query']);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'backup',
        label: 'Backup Database...',
        icon: 'backup',
        action: () => {
          if (node.databaseName) {
            this.openBackup(node.databaseName);
          }
        },
      },
      {
        id: 'restore',
        label: 'Restore Database...',
        icon: 'restore',
        action: () => {
          this.openRestore(node.databaseName);
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'rename',
        label: 'Rename...',
        icon: 'edit',
        disabled:
          node.databaseName === 'master' ||
          node.databaseName === 'msdb' ||
          node.databaseName === 'model' ||
          node.databaseName === 'tempdb',
        action: () => {
          if (node.databaseName && node.connectionId) {
            this.openRenameDatabaseDialog(node.connectionId, node.databaseName);
          }
        },
      },
      {
        id: 'delete',
        label: 'Delete...',
        icon: 'delete',
        disabled:
          node.databaseName === 'master' ||
          node.databaseName === 'msdb' ||
          node.databaseName === 'model' ||
          node.databaseName === 'tempdb',
        action: () => {
          if (node.databaseName) {
            this.openDeleteDialog(node.databaseName);
          }
        },
      },
    ];
  }

  private getFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getTableContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'select-top',
        label: 'Select Top 1000 Rows',
        icon: 'table_rows',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const sql = `SELECT TOP 1000 * FROM [${schema}].[${node.metadata.name}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'edit-top',
        label: 'Edit Top 200 Rows',
        icon: 'edit_note',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const sql = `SELECT TOP 200 * FROM [${schema}].[${node.metadata.name}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            this.router.navigate(['/query']);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'script-create',
        label: 'Script Table as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const sql = await window.forge.explorer.scriptTableAsCreate(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name
              );
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
              this.router.navigate(['/query']);
            } catch (err) {
              this.notification.error('Failed to generate CREATE script');
            }
          }
        },
      },
      {
        id: 'script-select',
        label: 'Script Table as SELECT',
        icon: 'code',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const sql = `SELECT * FROM [${schema}].[${node.metadata.name}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'script-insert',
        label: 'Script Table as INSERT',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const sql = await window.forge.explorer.scriptTableAsInsert(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name
              );
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
              this.router.navigate(['/query']);
            } catch (err) {
              this.notification.error('Failed to generate INSERT script');
            }
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'show-relationships',
        label: 'Show Relationships',
        icon: 'account_tree',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openErdTab(
              node.connectionId,
              node.databaseName,
              node.metadata.name,
              schema
            );
            this.router.navigate(['/erd']);
          }
        },
      },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || 'dbo',
              tableName: node.metadata.name,
            });
          }
        },
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'mj-change-history',
        label: 'View Change History (MJ)',
        icon: 'change_history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const tableName = node.metadata.name;
            const sql = `-- Change History for [${schema}].[${tableName}]
-- Note: Requires MemberJunction to be installed in this database
SELECT TOP 100
  rc.Type,
  rc.Source,
  rc.RecordID,
  rc.ChangesDescription,
  rc.Status,
  u.Name AS ChangedBy,
  rc.__mj_CreatedAt AS ChangedAt,
  rc.ChangesJSON
FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON rc.UserID = u.ID
WHERE e.BaseTable = '${tableName}' AND e.SchemaName = '${schema}'
ORDER BY rc.__mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'mj-audit-log',
        label: 'View Audit Log (MJ)',
        icon: 'history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const tableName = node.metadata.name;
            const sql = `-- Audit Log for [${schema}].[${tableName}]
-- Note: Requires MemberJunction to be installed in this database
SELECT TOP 100
  al.Status,
  alt.Name AS AuditType,
  al.RecordID,
  u.Name AS UserName,
  al.Description,
  al.__mj_CreatedAt AS AuditedAt
FROM [__mj].[AuditLog] al
LEFT JOIN [__mj].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
LEFT JOIN [__mj].[Entity] e ON al.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON al.UserID = u.ID
WHERE e.BaseTable = '${tableName}' AND e.SchemaName = '${schema}'
ORDER BY al.__mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      { id: 'div4', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getViewContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'select-top',
        label: 'Select Top 1000 Rows',
        icon: 'table_rows',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const sql = `SELECT TOP 1000 * FROM [${schema}].[${node.metadata.name}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
            this.router.navigate(['/query']);
          }
        },
      },
      {
        id: 'edit-top',
        label: 'Edit Top 200 Rows',
        icon: 'edit_note',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const sql = `SELECT TOP 200 * FROM [${schema}].[${node.metadata.name}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            this.router.navigate(['/query']);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'script-create',
        label: 'Script View as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'view'
              );
              const sql = result.definition || '-- View definition not available';
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get view definition');
            }
          }
        },
      },
      {
        id: 'script-alter',
        label: 'Script View as ALTER',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'view'
              );
              let sql = result.definition || '-- View definition not available';
              sql = sql.replace(/CREATE\s+VIEW\s+/i, 'ALTER VIEW ');
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get view definition');
            }
          }
        },
      },
      {
        id: 'script-select',
        label: 'Script View as SELECT',
        icon: 'code',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const sql = `SELECT * FROM [${schema}].[${node.metadata.name}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || 'dbo',
              tableName: node.metadata.name,
              objectType: 'view',
            });
          }
        },
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getFunctionContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'script-create',
        label: 'Script Function as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'function'
              );
              const sql = result.definition || '-- Function definition not available';
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get function definition');
            }
          }
        },
      },
      {
        id: 'script-alter',
        label: 'Script Function as ALTER',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'function'
              );
              let sql = result.definition || '-- Function definition not available';
              sql = sql.replace(/CREATE\s+FUNCTION\s+/i, 'ALTER FUNCTION ');
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get function definition');
            }
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || 'dbo',
              tableName: node.metadata.name,
              objectType: 'function',
            });
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getProcedureContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'execute',
        label: 'Execute Stored Procedure...',
        icon: 'play_arrow',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const schema = node.metadata.schema || 'dbo';
            const sql = `EXEC [${schema}].[${node.metadata.name}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      { id: 'div1', label: '', divider: true },
      {
        id: 'script-create',
        label: 'Script Procedure as CREATE',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'procedure'
              );
              const sql = result.definition || '-- Procedure definition not available';
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get procedure definition');
            }
          }
        },
      },
      {
        id: 'script-alter',
        label: 'Script Procedure as ALTER',
        icon: 'code',
        action: async () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            try {
              const schema = node.metadata.schema || 'dbo';
              const result = await window.forge.explorer.getDefinition(
                node.connectionId,
                node.databaseName,
                schema,
                node.metadata.name,
                'procedure'
              );
              let sql = result.definition || '-- Procedure definition not available';
              sql = sql.replace(/CREATE\s+(PROCEDURE|PROC)\s+/i, 'ALTER $1 ');
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
            } catch (err) {
              this.notification.error('Failed to get procedure definition');
            }
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        shortcut: 'Alt+Enter',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tableProperties.open({
              connectionId: node.connectionId,
              databaseName: node.databaseName,
              schema: node.metadata.schema || 'dbo',
              tableName: node.metadata.name,
              objectType: 'procedure',
            });
          }
        },
      },
      { id: 'div3', label: '', divider: true },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  // MemberJunction context menus
  private getMJEntityContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'select-top',
        label: 'SELECT TOP 1000',
        icon: 'table_chart',
        action: () => {
          if (node.connectionId && node.databaseName && node.schema && node.tableName) {
            const sql = `SELECT TOP 1000 * FROM [${node.schema}].[${node.tableName}]`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'view-change-history',
        label: 'View Change History',
        icon: 'change_history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const sql = `-- Change History for ${node.metadata.name}
SELECT TOP 100
  rc.Type,
  rc.Source,
  rc.ChangesDescription,
  rc.Status,
  u.Name AS ChangedBy,
  rc.__mj_CreatedAt AS ChangedAt,
  rc.ChangesJSON
FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON rc.UserID = u.ID
WHERE e.Name = '${node.metadata.name}'
ORDER BY rc.__mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'view-audit-log',
        label: 'View Audit Log',
        icon: 'history',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            const sql = `-- Audit Log for ${node.metadata.name}
SELECT TOP 100
  al.Status,
  alt.Name AS AuditType,
  u.Name AS UserName,
  al.RecordID,
  al.Description,
  al.__mj_CreatedAt AS AuditedAt
FROM [__mj].[AuditLog] al
LEFT JOIN [__mj].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
LEFT JOIN [__mj].[Entity] e ON al.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON al.UserID = u.ID
WHERE e.Name = '${node.metadata.name}'
ORDER BY al.__mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
    ];
  }

  private getMJQueryContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'open-query',
        label: 'Open in New Tab',
        icon: 'code',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata?.definition) {
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(
              node.connectionId,
              node.databaseName,
              node.metadata.definition
            );
          }
        },
      },
    ];
  }

  private getMJChangesFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'view-all-changes',
        label: 'View All Change History',
        icon: 'change_history',
        action: () => {
          if (node.connectionId && node.databaseName) {
            const sql = `-- All Recent Record Changes
SELECT TOP 200
  e.Name AS Entity,
  rc.RecordID,
  rc.Type,
  rc.Source,
  rc.ChangesDescription,
  rc.Status,
  u.Name AS ChangedBy,
  rc.__mj_CreatedAt AS ChangedAt
FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON rc.UserID = u.ID
ORDER BY rc.__mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getMJAuditFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'view-all-audits',
        label: 'View All Audit Logs',
        icon: 'history',
        action: () => {
          if (node.connectionId && node.databaseName) {
            const sql = `-- All Recent Audit Logs
SELECT TOP 200
  al.Status,
  alt.Name AS AuditType,
  e.Name AS Entity,
  al.RecordID,
  u.Name AS UserName,
  al.Description,
  al.__mj_CreatedAt AS AuditedAt
FROM [__mj].[AuditLog] al
LEFT JOIN [__mj].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
LEFT JOIN [__mj].[Entity] e ON al.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON al.UserID = u.ID
ORDER BY al.__mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  private getMJErrorsFolderContextMenu(node: TreeNode): ContextMenuItem[] {
    return [
      {
        id: 'view-all-errors',
        label: 'View All Error Logs',
        icon: 'error',
        action: () => {
          if (node.connectionId && node.databaseName) {
            const sql = `-- All Recent Error Logs
SELECT TOP 200
  Code,
  Message,
  Category,
  Status,
  CreatedBy,
  __mj_CreatedAt AS CreatedAt,
  Details
FROM [__mj].[ErrorLog]
ORDER BY __mj_CreatedAt DESC`;
            this.connectionState.selectDatabase(node.databaseName);
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql);
          }
        },
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        action: () => this.explorerState.refreshNode(node.id),
      },
    ];
  }

  // Database create/rename/delete dialog methods
  /** Public wrapper – uses the active connection when called from the database dropdown menu */
  openCreateDatabaseDialog(connectionId?: string): void {
    const connId = connectionId || this.connectionState.activeConnectionId();
    if (!connId) {
      this.notification.error('No active connection');
      return;
    }
    this._openCreateDatabaseDialog(connId);
  }

  private _openCreateDatabaseDialog(connectionId: string): void {
    const dialogData: CreateDatabaseDialogData = {
      connectionId,
    };

    const dialogRef = this.dialog.open(CreateDatabaseDialogComponent, {
      data: dialogData,
      width: '450px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success && result.databaseName) {
        // Refresh the database list
        this.connectionState.loadDatabases();
        // Refresh explorer tree
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          this.explorerState.refreshNode(serverNode.id);
        }
      }
    });
  }

  private openRenameDatabaseDialog(connectionId: string, databaseName: string): void {
    const dialogData: RenameDatabaseDialogData = {
      connectionId,
      databaseName,
    };

    const dialogRef = this.dialog.open(RenameDatabaseDialogComponent, {
      data: dialogData,
      width: '450px',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result?.success && result.newName) {
        // Refresh the database list
        this.connectionState.loadDatabases();
        // If the renamed database was selected, update selection
        if (this.connectionState.selectedDatabase() === databaseName) {
          this.connectionState.selectDatabase(result.newName);
        }
        // Refresh explorer tree
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          this.explorerState.refreshNode(serverNode.id);
        }
      }
    });
  }

  private openRenameDialog(databaseName: string): void {
    this.pendingRenameDatabase = databaseName;
    this.renameDialog.open({
      title: 'Rename Database',
      message: `Enter a new name for the database "${databaseName}".`,
      inputLabel: 'New Database Name',
      inputValue: databaseName,
      inputPlaceholder: 'Enter new database name',
      confirmText: 'Rename',
      validate: (value: string) => {
        if (!value.trim()) return 'Database name is required';
        if (value === databaseName) return 'New name must be different';
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
          return 'Invalid database name. Use letters, numbers, and underscores only.';
        }
        if (value.length > 128) return 'Database name is too long (max 128 characters)';
        return null;
      },
    });
  }

  private openDeleteDialog(databaseName: string): void {
    this.pendingDeleteDatabase = databaseName;
    this.deleteDialog.open({
      title: 'Delete Database',
      message: `Are you sure you want to delete the database "${databaseName}"? This action cannot be undone and all data will be permanently lost.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger',
      confirmationInput: databaseName,
    });
  }

  async onRenameConfirmed(newName: string): Promise<void> {
    const oldName = this.pendingRenameDatabase;
    this.pendingRenameDatabase = null;

    if (!oldName) return;

    const connectionId = this.connectionState.activeConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    try {
      const result = await firstValueFrom(
        this.ipc.renameDatabase(connectionId, { currentName: oldName, newName })
      );

      if (result?.success) {
        this.notification.success(`Database renamed to "${newName}"`);
        // Refresh the database list
        await this.connectionState.loadDatabases();
        // If the renamed database was selected, update selection
        if (this.connectionState.selectedDatabase() === oldName) {
          this.connectionState.selectDatabase(newName);
        }
        // Refresh explorer tree
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          await this.explorerState.refreshNode(serverNode.id);
        }
      } else {
        this.notification.error(result?.error || 'Failed to rename database');
      }
    } catch (error) {
      this.notification.error(error instanceof Error ? error.message : 'Failed to rename database');
    }
  }

  async onDeleteConfirmed(): Promise<void> {
    const databaseName = this.pendingDeleteDatabase;
    this.pendingDeleteDatabase = null;

    if (!databaseName) return;

    const connectionId = this.connectionState.activeConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    try {
      const result = await firstValueFrom(
        this.ipc.deleteDatabase(connectionId, { name: databaseName, closeConnections: true })
      );

      if (result?.success) {
        this.notification.success(`Database "${databaseName}" deleted`);
        // Refresh the database list
        await this.connectionState.loadDatabases();
        // If the deleted database was selected, clear selection
        if (this.connectionState.selectedDatabase() === databaseName) {
          this.connectionState.selectDatabase('');
        }
        // Refresh explorer tree
        const serverNode = this.explorerState
          .rootNodes()
          .find((n: TreeNode) => n.type === 'server' && n.connectionId === connectionId);
        if (serverNode) {
          await this.explorerState.refreshNode(serverNode.id);
        }
      } else {
        this.notification.error(result?.error || 'Failed to delete database');
      }
    } catch (error) {
      this.notification.error(error instanceof Error ? error.message : 'Failed to delete database');
    }
  }
}
