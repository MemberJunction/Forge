import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom } from 'rxjs';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { GoldenLayoutContainerComponent } from '../golden-layout-container/golden-layout-container.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { ConnectionStateService } from '../../core/state/connection.state';
import { TabStateService } from '../../core/state/tab.state';
import { MenuService } from '../../core/services/menu.service';
import { QueryHistoryService } from '../../core/services/query-history.service';
import { IpcService } from '../../core/services/ipc.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, MatDialogModule, SidebarComponent, GoldenLayoutContainerComponent, StatusBarComponent],
  template: `
    <div class="shell">
      @if (!sidebarHidden()) {
        <app-sidebar class="sidebar" />
      }
      <div class="main-area">
        <app-golden-layout-container class="content-area" />
        <app-status-bar class="status-bar" />
      </div>
    </div>
  `,
  styles: [
    `
      .shell {
        display: flex;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        background-color: var(--bg-primary);
      }

      .sidebar {
        width: var(--sidebar-width);
        min-width: var(--sidebar-width);
        max-width: var(--sidebar-width);
        height: 100%;
        border-right: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
      }

      .main-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        height: 100%;
      }

      .content-area {
        flex: 1;
        overflow: hidden;
        background-color: var(--bg-primary);
      }

      .status-bar {
        flex-shrink: 0;
        height: var(--status-bar-height);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
      }
    `,
  ],
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly menuService = inject(MenuService);
  private readonly queryHistory = inject(QueryHistoryService);
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  private readonly dialog = inject(MatDialog);

  readonly sidebarHidden = signal(false);
  private subscriptions: Subscription[] = [];

  ngOnInit(): void {
    // Load saved connection profiles on startup
    this.connectionState.loadProfiles();

    // Listen for sidebar toggle from menu
    this.subscriptions.push(
      this.menuService.toggleSidebar$.subscribe(() => {
        this.sidebarHidden.update(hidden => !hidden);
      })
    );

    // Listen for query history from menu (Cmd+Shift+H)
    this.subscriptions.push(
      this.menuService.queryHistory$.subscribe(() => {
        this.queryHistory.openHistoryDialog();
      })
    );

    // Listen for close tab from menu (Cmd+W)
    this.subscriptions.push(
      this.menuService.closeTab$.subscribe(() => {
        const activeTab = this.tabState.activeTab();
        if (activeTab) {
          this.tabState.closeTab(activeTab.id);
        }
      })
    );

    // Listen for show keyboard shortcuts from menu
    this.subscriptions.push(
      this.menuService.showShortcuts$.subscribe(() => {
        window.dispatchEvent(new CustomEvent('forge:show-shortcuts'));
      })
    );

    // Listen for server properties from menu
    this.subscriptions.push(
      this.menuService.serverProperties$.subscribe(() => {
        this.showServerProperties();
      })
    );

    // Listen for database properties from menu
    this.subscriptions.push(
      this.menuService.databaseProperties$.subscribe(() => {
        this.showDatabaseProperties();
      })
    );

    // Listen for new database from menu
    this.subscriptions.push(
      this.menuService.newDatabase$.subscribe(() => {
        this.showNewDatabaseDialog();
      })
    );
  }

  private async showServerProperties(): Promise<void> {
    const connectionId = this.connectionState.activeConnectionId();
    if (!connectionId) {
      this.notification.warning('No active connection');
      return;
    }

    try {
      const result = await firstValueFrom(
        this.ipc.executeQuery({
          connectionId,
          sql: `SELECT @@VERSION AS [Version], @@SERVERNAME AS [Server Name],
                SERVERPROPERTY('ProductVersion') AS [Product Version],
                SERVERPROPERTY('Edition') AS [Edition],
                SERVERPROPERTY('ProductLevel') AS [Product Level],
                SERVERPROPERTY('EngineEdition') AS [Engine Edition],
                SERVERPROPERTY('Collation') AS [Collation],
                SERVERPROPERTY('IsClustered') AS [Is Clustered],
                SERVERPROPERTY('IsFullTextInstalled') AS [Full-Text Installed]`,
          queryId: `server-props-${Date.now()}`,
        })
      );

      if (result?.success && result.resultSets?.length) {
        const row = result.resultSets[0].rows[0];
        const props = Object.entries(row || {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
        this.notification.info(`Server Properties:\n${props}`);
      }
    } catch {
      this.notification.error('Failed to retrieve server properties');
    }
  }

  private async showDatabaseProperties(): Promise<void> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) {
      this.notification.warning('No active connection or database selected');
      return;
    }

    try {
      const safeDb = database.replace(/\]/g, ']]');
      const result = await firstValueFrom(
        this.ipc.executeQuery({
          connectionId,
          database,
          sql: `SELECT
                  DB_NAME() AS [Database],
                  DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS [Collation],
                  DATABASEPROPERTYEX(DB_NAME(), 'Recovery') AS [Recovery Model],
                  DATABASEPROPERTYEX(DB_NAME(), 'Status') AS [Status],
                  (SELECT SUM(size * 8.0 / 1024) FROM sys.database_files WHERE type = 0) AS [Data Size MB],
                  (SELECT SUM(size * 8.0 / 1024) FROM sys.database_files WHERE type = 1) AS [Log Size MB],
                  SUSER_SNAME(owner_sid) AS [Owner]
                FROM sys.databases WHERE name = '${safeDb}'`,
          queryId: `db-props-${Date.now()}`,
        })
      );

      if (result?.success && result.resultSets?.length) {
        const row = result.resultSets[0].rows[0];
        const props = Object.entries(row || {})
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
        this.notification.info(`Database Properties:\n${props}`);
      }
    } catch {
      this.notification.error('Failed to retrieve database properties');
    }
  }

  private showNewDatabaseDialog(): void {
    if (!this.connectionState.isConnected()) {
      this.notification.warning('No active connection');
      return;
    }
    // Import and open the create database dialog dynamically
    import('../../shared/components/create-database-dialog/create-database-dialog.component').then(mod => {
      this.dialog.open(mod.CreateDatabaseDialogComponent, {
        width: '480px',
        data: { connectionId: this.connectionState.activeConnectionId() },
      });
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}
