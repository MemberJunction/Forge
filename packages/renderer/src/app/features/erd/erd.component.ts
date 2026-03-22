import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TabStateService } from '../../core/state/tab.state';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ERDAdapterService } from '../../core/services/erd-adapter.service';
import { NotificationService } from '../../core/services/notification.service';
import { ERDDiagramComponent, ERDNode } from '../../shared/components/erd-diagram';

@Component({
  selector: 'app-erd',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    ERDDiagramComponent,
  ],
  template: `
    <div class="erd-container">
      @if (activeTab(); as tab) {
        @if (tab.type === 'erd') {
          @if (isLoading()) {
            <div class="loading-state">
              <mat-spinner diameter="48"></mat-spinner>
              <p>Loading entity relationships...</p>
            </div>
          } @else if (error()) {
            <div class="error-state">
              <mat-icon>error_outline</mat-icon>
              <h3>Failed to load relationships</h3>
              <p>{{ error() }}</p>
              <button mat-stroked-button (click)="loadERD()">
                <mat-icon>refresh</mat-icon>
                Retry
              </button>
            </div>
          } @else if (nodes().length === 0) {
            <div class="empty-state">
              <mat-icon>account_tree</mat-icon>
              <h3>No Relationships Found</h3>
              <p>This table has no foreign key relationships.</p>
            </div>
          } @else {
            <app-erd-diagram
              [nodes]="nodes()"
              [selectedNodeId]="selectedNodeId()"
              [focusNodeId]="focusNodeId()"
              [focusDepth]="focusDepth()"
              [headerTitle]="diagramTitle()"
              (nodeSelected)="onNodeSelected($event)"
              (nodeDeselected)="onNodeDeselected()"
              (nodeDoubleClick)="onNodeDoubleClick($event)"
              (refreshRequested)="loadERD()"
            />
          }
        } @else {
          <div class="no-selection">
            <mat-icon>account_tree</mat-icon>
            <h2>Entity Relationship Diagram</h2>
            <p>Select a table from the sidebar and choose "Show Relationships" to view its ERD.</p>
          </div>
        }
      } @else {
        <div class="no-selection">
          <mat-icon>account_tree</mat-icon>
          <h2>Entity Relationship Diagram</h2>
          <p>Select a table from the sidebar and choose "Show Relationships" to view its ERD.</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .erd-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: var(--bg-primary);
      }

      app-erd-diagram {
        flex: 1;
        min-height: 0;
      }

      .loading-state,
      .error-state,
      .empty-state,
      .no-selection {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-muted);
        text-align: center;
        padding: var(--spacing-xl);

        mat-icon {
          font-size: 64px;
          width: 64px;
          height: 64px;
          opacity: 0.5;
          margin-bottom: var(--spacing-md);
        }

        h2,
        h3 {
          font-size: var(--font-size-xl);
          margin: 0 0 var(--spacing-sm);
          color: var(--text-primary);
        }

        p {
          margin: 0 0 var(--spacing-md);
          max-width: 400px;
        }

        button {
          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            margin-right: var(--spacing-xs);
            opacity: 1;
          }
        }
      }

      .loading-state {
        mat-spinner {
          margin-bottom: var(--spacing-md);
        }
      }

      .error-state {
        mat-icon {
          color: var(--status-error);
        }
      }
    `,
  ],
})
export class ErdComponent implements OnInit {
  private readonly tabState = inject(TabStateService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly erdAdapter = inject(ERDAdapterService);
  private readonly notification = inject(NotificationService);

  readonly activeTab = this.tabState.activeTab;

  readonly nodes = signal<ERDNode[]>([]);
  readonly selectedNodeId = signal<string | null>(null);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  readonly focusNodeId = computed(() => {
    const tab = this.activeTab();
    if (tab?.type === 'erd' && tab.metadata?.['tableName']) {
      const schema = tab.metadata['schema'] || 'dbo';
      const tableName = tab.metadata['tableName'] as string;
      return `${schema}.${tableName}`;
    }
    return null;
  });

  readonly focusDepth = computed(() => {
    const tab = this.activeTab();
    return (tab?.metadata?.['focusDepth'] as number) || 2;
  });

  readonly diagramTitle = computed(() => {
    const tab = this.activeTab();
    if (tab?.type === 'erd') {
      const tableName = tab.metadata?.['tableName'] as string;
      if (tableName) {
        return `Relationships: ${tableName}`;
      }
      return `Database ERD: ${tab.databaseName}`;
    }
    return 'Entity Relationship Diagram';
  });

  private currentTabId: string | null = null;

  ngOnInit(): void {
    // Load ERD when component initializes
    this.loadERD();
  }

  async loadERD(): Promise<void> {
    const tab = this.activeTab();
    if (!tab || tab.type !== 'erd' || !tab.connectionId || !tab.databaseName) {
      return;
    }

    // Don't reload if same tab
    if (this.currentTabId === tab.id && this.nodes().length > 0) {
      return;
    }

    this.currentTabId = tab.id;
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const tableName = tab.metadata?.['tableName'] as string | undefined;
      const schema = (tab.metadata?.['schema'] as string) || 'dbo';

      let erdNodes: ERDNode[];

      if (tableName) {
        // Load ERD for specific table with relationships
        erdNodes = await this.erdAdapter.buildERDForTableWithRelations(
          tab.connectionId,
          tab.databaseName,
          schema,
          tableName,
          this.focusDepth()
        );
      } else {
        // Load ERD for entire database
        erdNodes = await this.erdAdapter.buildERDForDatabase(tab.connectionId, tab.databaseName);
      }

      this.nodes.set(erdNodes);

      // Auto-select the focused table
      if (tableName) {
        this.selectedNodeId.set(`${schema}.${tableName}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load relationships';
      this.error.set(message);
      this.notification.error(message);
    } finally {
      this.isLoading.set(false);
    }
  }

  onNodeSelected(node: ERDNode): void {
    this.selectedNodeId.set(node.id);
  }

  onNodeDeselected(): void {
    this.selectedNodeId.set(null);
  }

  onNodeDoubleClick(event: { node: ERDNode }): void {
    const node = event.node;
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (connectionId && database) {
      const sql = `SELECT TOP 1000 * FROM [${node.schemaName}].[${node.name}]`;
      this.tabState.openQueryTab(connectionId, database, sql, true);
    }
  }
}
