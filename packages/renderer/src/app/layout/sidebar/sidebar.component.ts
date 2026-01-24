import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ExplorerStateService, TreeNode } from '../../core/state/explorer.state';
import { TabStateService } from '../../core/state/tab.state';
import { ContextMenuService, ContextMenuItem } from '../../core/services/context-menu.service';
import { NotificationService } from '../../core/services/notification.service';
import { TablePropertiesService } from '../../core/services/table-properties.service';
import { IpcService } from '../../core/services/ipc.service';
import { ConfirmDialogComponent } from '../../shared/components/dialog/confirm-dialog.component';
import { InputDialogComponent } from '../../shared/components/dialog/input-dialog.component';

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
    ConfirmDialogComponent,
    InputDialogComponent,
  ],
  template: `
    <div class="sidebar-container">
      <!-- Header -->
      <div class="sidebar-header">
        <span class="logo">MJ Forge</span>
        <button mat-icon-button matTooltip="New Connection" (click)="openConnectionDialog()">
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
            [disabled]="connectionState.loadingDatabases()"
          >
            <mat-icon>storage</mat-icon>
            <span class="database-name">
              {{ connectionState.selectedDatabase() || 'Select Database' }}
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
                <mat-icon>{{
                  db.name === connectionState.selectedDatabase() ? 'check' : 'storage'
                }}</mat-icon>
                <span>{{ db.name }}</span>
              </button>
            }
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
          <div class="tree-container">
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
          [class.selected]="node.id === explorerState.selectedNodeId()"
          [style.padding-left.px]="level * 16 + 8"
          (click)="onNodeClick(node)"
          (dblclick)="onNodeDoubleClick(node)"
          (contextmenu)="onNodeRightClick(node, $event)"
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
          <mat-icon class="node-icon" [class]="'icon-' + node.type">{{ node.icon }}</mat-icon>
          <span class="node-name">{{ node.name }}</span>
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
            (click)="newQuery()"
            [disabled]="!connectionState.isConnected() || !connectionState.selectedDatabase()"
          >
            <mat-icon>code</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Refresh"
            (click)="refresh()"
            [disabled]="!connectionState.isConnected()"
          >
            <mat-icon>refresh</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Backup Database"
            (click)="openBackup()"
            [disabled]="!connectionState.isConnected() || !connectionState.selectedDatabase()"
          >
            <mat-icon>backup</mat-icon>
          </button>
          <button
            mat-icon-button
            matTooltip="Restore Database"
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
        border-bottom: 1px solid var(--border-primary);
      }

      .logo {
        font-size: var(--font-size-lg);
        font-weight: 600;
        color: var(--text-primary);
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

        .mat-icon {
          margin-right: var(--spacing-sm);
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        .connection-name,
        .database-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dropdown-icon {
          margin-right: 0;
          margin-left: auto;
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

        &:hover {
          background-color: var(--bg-hover);
        }

        &.selected {
          background-color: var(--bg-active);
        }
      }

      .expand-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
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
        width: 20px;
        height: 20px;
      }

      .node-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        margin-right: var(--spacing-xs);

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

  // State for pending database operations
  private pendingDeleteDatabase: string | null = null;
  private pendingRenameDatabase: string | null = null;

  openConnectionDialog(): void {
    this.router.navigate(['/connections']);
  }

  manageConnections(): void {
    this.router.navigate(['/connections']);
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
  }

  onNodeDoubleClick(node: TreeNode): void {
    if (node.hasChildren) {
      this.explorerState.toggleNode(node.id);
    } else if (node.connectionId && node.databaseName && node.metadata) {
      // Open object details tab
      this.tabState.openObjectTab(
        node.connectionId,
        node.databaseName,
        node.metadata.name,
        node.metadata.type
      );
      this.router.navigate(['/explorer']);
    }
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

  openBackup(): void {
    this.router.navigate(['/backup']);
  }

  openRestore(): void {
    this.router.navigate(['/restore']);
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
            this.connectionState.selectDatabase(node.databaseName);
            this.router.navigate(['/backup']);
          }
        },
      },
      {
        id: 'restore',
        label: 'Restore Database...',
        icon: 'restore',
        action: () => {
          this.router.navigate(['/restore']);
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
          if (node.databaseName) {
            this.openRenameDialog(node.databaseName);
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
        disabled: true,
        action: () => {
          this.notification.info('Edit rows feature coming soon');
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
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
              this.router.navigate(['/query']);
            } catch (err) {
              this.notification.error('Failed to get view definition');
            }
          }
        },
      },
      { id: 'div2', label: '', divider: true },
      {
        id: 'properties',
        label: 'Properties...',
        icon: 'info',
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tabState.openObjectTab(
              node.connectionId,
              node.databaseName,
              node.metadata.name,
              node.metadata.type
            );
            this.router.navigate(['/explorer']);
          }
        },
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
            this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
            this.router.navigate(['/query']);
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
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
              this.router.navigate(['/query']);
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
              // Replace CREATE with ALTER in the definition
              let sql = result.definition || '-- Procedure definition not available';
              sql = sql.replace(/CREATE\s+(PROCEDURE|PROC)\s+/i, 'ALTER $1 ');
              this.connectionState.selectDatabase(node.databaseName);
              this.tabState.openQueryTab(node.connectionId, node.databaseName, sql, true);
              this.router.navigate(['/query']);
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
        action: () => {
          if (node.connectionId && node.databaseName && node.metadata) {
            this.tabState.openObjectTab(
              node.connectionId,
              node.databaseName,
              node.metadata.name,
              node.metadata.type
            );
            this.router.navigate(['/explorer']);
          }
        },
      },
    ];
  }

  // Database rename/delete dialog methods
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
      const result = await this.ipc
        .renameDatabase(connectionId, { currentName: oldName, newName })
        .toPromise();

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
      const result = await this.ipc
        .deleteDatabase(connectionId, { name: databaseName, closeConnections: true })
        .toPromise();

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
