import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TabStateService } from '../../core/state/tab.state';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ERDAdapterService } from '../../core/services/erd-adapter.service';
import { NotificationService } from '../../core/services/notification.service';
import { TablePropertiesService } from '../../core/services/table-properties.service';
import { IpcService } from '../../core/services/ipc.service';
import { ERDDiagramComponent, ERDNode, ERDField } from '../../shared/components/erd-diagram';
import { firstValueFrom } from 'rxjs';
import type { MJEntityInfo } from '@mj-forge/shared';

interface NodePanelInfo {
  node: ERDNode;
  mjEntity: MJEntityInfo | null;
}

@Component({
  selector: 'app-erd',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
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
            <div class="erd-workspace">
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

              <!-- Slide-in panel -->
              @if (panelInfo(); as info) {
                <div class="node-panel" [class.open]="panelOpen()">
                  <div class="panel-header">
                    <div class="panel-title-row">
                      <mat-icon class="panel-icon">table_chart</mat-icon>
                      <div class="panel-title-text">
                        <h3>{{ info.node.name }}</h3>
                        <span class="panel-subtitle">{{ info.node.schemaName }}.{{ info.node.name }}</span>
                      </div>
                    </div>
                    <button class="panel-close" (click)="closePanel()">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>

                  <!-- MJ Entity badge -->
                  @if (info.mjEntity) {
                    <div class="mj-entity-badge">
                      <mat-icon>star</mat-icon>
                      <span>MJ Entity: {{ info.mjEntity.name }}</span>
                    </div>
                  }

                  <!-- Actions -->
                  <div class="panel-actions">
                    <button mat-stroked-button (click)="openTableProperties(info.node)">
                      <mat-icon>info</mat-icon>
                      Table Properties
                    </button>
                    <button mat-stroked-button (click)="selectTop1000(info.node)">
                      <mat-icon>table_chart</mat-icon>
                      SELECT TOP 1000
                    </button>
                    @if (info.mjEntity) {
                      <button mat-stroked-button (click)="viewChangeHistory(info.node, info.mjEntity!)">
                        <mat-icon>change_history</mat-icon>
                        Change History
                      </button>
                      <button mat-stroked-button (click)="viewAuditLog(info.node, info.mjEntity!)">
                        <mat-icon>history</mat-icon>
                        Audit Log
                      </button>
                    }
                  </div>

                  <!-- Columns -->
                  <div class="panel-section">
                    <h4>Columns ({{ info.node.fields.length }})</h4>
                    <div class="column-list">
                      @for (field of info.node.fields; track field.id) {
                        <div class="column-row" [class.pk]="field.isPrimaryKey" [class.fk]="!!field.relatedNodeId">
                          <div class="column-badges">
                            @if (field.isPrimaryKey) {
                              <span class="badge pk" matTooltip="Primary Key">PK</span>
                            }
                            @if (field.relatedNodeId) {
                              <span class="badge fk" matTooltip="Foreign Key → {{ field.relatedNodeName }}">FK</span>
                            }
                          </div>
                          <span class="column-name">{{ field.name }}</span>
                          <span class="column-type">{{ field.type }}</span>
                          @if (field.allowsNull === false) {
                            <span class="not-null" matTooltip="NOT NULL">*</span>
                          }
                        </div>
                      }
                    </div>
                  </div>

                  <!-- MJ Entity details -->
                  @if (info.mjEntity; as entity) {
                    <div class="panel-section">
                      <h4>MJ Entity Details</h4>
                      <div class="entity-details">
                        @if (entity.description) {
                          <div class="detail-row">
                            <span class="detail-label">Description</span>
                            <span class="detail-value">{{ entity.description }}</span>
                          </div>
                        }
                        <div class="detail-row">
                          <span class="detail-label">Base View</span>
                          <span class="detail-value">{{ entity.baseView || '—' }}</span>
                        </div>
                        <div class="detail-row">
                          <span class="detail-label">Track Changes</span>
                          <span class="detail-value">{{ entity.trackRecordChanges ? 'Yes' : 'No' }}</span>
                        </div>
                        <div class="detail-row">
                          <span class="detail-label">Audit Access</span>
                          <span class="detail-value">{{ entity.auditRecordAccess ? 'Yes' : 'No' }}</span>
                        </div>
                        <div class="detail-row">
                          <span class="detail-label">API</span>
                          <span class="detail-value api-flags">
                            @if (entity.includeInAPI) { <span class="api-flag on">API</span> }
                            @if (entity.allowCreateAPI) { <span class="api-flag on">C</span> }
                            @if (entity.allowUpdateAPI) { <span class="api-flag on">U</span> }
                            @if (entity.allowDeleteAPI) { <span class="api-flag on">D</span> }
                          </span>
                        </div>
                      </div>
                    </div>
                  }

                  <!-- Relationships -->
                  @if (getRelationships(info.node); as rels) {
                    @if (rels.length > 0) {
                      <div class="panel-section">
                        <h4>Relationships ({{ rels.length }})</h4>
                        <div class="relationship-list">
                          @for (rel of rels; track rel.id) {
                            <div class="relationship-row" (click)="navigateToNode(rel.relatedNodeId!)">
                              <mat-icon class="rel-icon">{{ rel.relatedNodeId ? 'arrow_forward' : 'arrow_back' }}</mat-icon>
                              <span class="rel-field">{{ rel.name }}</span>
                              <mat-icon class="rel-arrow">arrow_right_alt</mat-icon>
                              <span class="rel-target">{{ rel.relatedNodeName }}</span>
                            </div>
                          }
                        </div>
                      </div>
                    }
                  }
                </div>
              }
            </div>
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

      .erd-workspace {
        display: flex;
        flex: 1;
        min-height: 0;
        position: relative;
        overflow: hidden;
      }

      app-erd-diagram {
        flex: 1;
        min-height: 0;
        min-width: 0;
      }

      /* Slide-in panel */
      .node-panel {
        width: 340px;
        min-width: 340px;
        background: var(--bg-secondary);
        border-left: 1px solid var(--border-primary);
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        transform: translateX(100%);
        transition: transform 0.25s ease;
        position: absolute;
        right: 0;
        top: 0;
        bottom: 0;
        z-index: 10;
        box-shadow: -4px 0 16px rgba(0, 0, 0, 0.2);
      }

      .node-panel.open {
        transform: translateX(0);
      }

      .panel-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 16px;
        border-bottom: 1px solid var(--border-primary);
        gap: 8px;
      }

      .panel-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .panel-icon {
        color: var(--accent-primary);
        font-size: 24px;
        width: 24px;
        height: 24px;
        flex-shrink: 0;
      }

      .panel-title-text {
        min-width: 0;
      }

      .panel-title-text h3 {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .panel-subtitle {
        font-size: 11px;
        color: var(--text-muted);
      }

      .panel-close {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-muted);
        padding: 4px;
        border-radius: 4px;
        display: flex;
        flex-shrink: 0;
        mat-icon { font-size: 18px; width: 18px; height: 18px; }
        &:hover { color: var(--text-primary); background: var(--bg-hover); }
      }

      .mj-entity-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
        border-bottom: 1px solid var(--border-primary);
        font-size: 12px;
        font-weight: 600;
        color: var(--accent-primary);
        mat-icon { font-size: 14px; width: 14px; height: 14px; }
      }

      .panel-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-primary);
        button {
          font-size: 12px;
          justify-content: flex-start;
          mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 6px; }
        }
      }

      .panel-section {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-primary);
        h4 {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          margin: 0 0 8px;
        }
      }

      .column-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .column-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 12px;
        &:hover { background: var(--bg-hover); }
      }

      .column-badges {
        display: flex;
        gap: 2px;
        width: 40px;
        flex-shrink: 0;
      }

      .badge {
        font-size: 9px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 3px;
        line-height: 1.3;
      }

      .badge.pk {
        background: color-mix(in srgb, #fbbf24 20%, transparent);
        color: #fbbf24;
      }

      .badge.fk {
        background: color-mix(in srgb, #60a5fa 20%, transparent);
        color: #60a5fa;
      }

      .column-name {
        color: var(--text-primary);
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .column-type {
        color: var(--text-muted);
        font-size: 11px;
        flex-shrink: 0;
      }

      .not-null {
        color: var(--status-error);
        font-weight: 700;
        font-size: 14px;
        flex-shrink: 0;
      }

      .entity-details {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        font-size: 12px;
        gap: 12px;
      }

      .detail-label {
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .detail-value {
        color: var(--text-primary);
        text-align: right;
        min-width: 0;
        overflow-wrap: break-word;
      }

      .api-flags {
        display: flex;
        gap: 4px;
      }

      .api-flag {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 3px;
      }

      .api-flag.on {
        background: color-mix(in srgb, var(--status-success) 20%, transparent);
        color: var(--status-success);
      }

      .relationship-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .relationship-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        &:hover { background: var(--bg-hover); }
      }

      .rel-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        color: var(--accent-primary);
        flex-shrink: 0;
      }

      .rel-field {
        color: var(--text-secondary);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .rel-arrow {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .rel-target {
        color: var(--accent-primary);
        font-weight: 500;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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
  private readonly tableProperties = inject(TablePropertiesService);
  private readonly ipc = inject(IpcService);

  readonly activeTab = this.tabState.activeTab;

  readonly nodes = signal<ERDNode[]>([]);
  readonly selectedNodeId = signal<string | null>(null);
  readonly panelInfo = signal<NodePanelInfo | null>(null);
  readonly panelOpen = signal(false);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);

  // Cache MJ entities so we don't re-fetch on every click
  private mjEntitiesCache: MJEntityInfo[] | null = null;
  private mjEntitiesCacheKey = '';

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
    this.loadERD();
  }

  async loadERD(): Promise<void> {
    const tab = this.activeTab();
    if (!tab || tab.type !== 'erd' || !tab.connectionId || !tab.databaseName) {
      return;
    }

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
        erdNodes = await this.erdAdapter.buildERDForTableWithRelations(
          tab.connectionId,
          tab.databaseName,
          schema,
          tableName,
          this.focusDepth()
        );
      } else {
        erdNodes = await this.erdAdapter.buildERDForDatabase(tab.connectionId, tab.databaseName);
      }

      this.nodes.set(erdNodes);

      if (tableName) {
        this.selectedNodeId.set(`${schema}.${tableName}`);
      }

      // Pre-load MJ entities for the badge detection
      this.loadMJEntities(tab.connectionId, tab.databaseName);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load relationships';
      this.error.set(message);
      this.notification.error(message);
    } finally {
      this.isLoading.set(false);
    }
  }

  async onNodeSelected(node: ERDNode): Promise<void> {
    this.selectedNodeId.set(node.id);

    // Find matching MJ entity
    const mjEntity = await this.findMJEntity(node);

    this.panelInfo.set({ node, mjEntity });
    // Small delay so the DOM renders before adding the open class
    requestAnimationFrame(() => this.panelOpen.set(true));
  }

  onNodeDeselected(): void {
    this.selectedNodeId.set(null);
    this.closePanel();
  }

  closePanel(): void {
    this.panelOpen.set(false);
    // Clear info after animation
    setTimeout(() => {
      if (!this.panelOpen()) {
        this.panelInfo.set(null);
      }
    }, 250);
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

  openTableProperties(node: ERDNode): void {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (connectionId && database) {
      this.tableProperties.open({
        connectionId,
        databaseName: database,
        schema: node.schemaName || 'dbo',
        tableName: node.name,
      });
    }
  }

  selectTop1000(node: ERDNode): void {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (connectionId && database) {
      const sql = `SELECT TOP 1000 * FROM [${node.schemaName}].[${node.name}]`;
      this.tabState.openQueryTab(connectionId, database, sql, true);
    }
  }

  viewChangeHistory(node: ERDNode, entity: MJEntityInfo): void {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (connectionId && database) {
      const sql = `-- Change History for ${entity.name}
SELECT TOP 100
  rc.Type,
  rc.Source,
  rc.ChangesDescription,
  rc.Status,
  u.Name AS ChangedBy,
  rc.CreatedAt AS ChangedAt,
  rc.ChangesJSON
FROM [__mj].[RecordChange] rc
LEFT JOIN [__mj].[Entity] e ON rc.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON rc.UserID = u.ID
WHERE e.Name = '${entity.name}'
ORDER BY rc.CreatedAt DESC`;
      this.tabState.openQueryTab(connectionId, database, sql);
    }
  }

  viewAuditLog(node: ERDNode, entity: MJEntityInfo): void {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (connectionId && database) {
      const sql = `-- Audit Log for ${entity.name}
SELECT TOP 100
  al.Status,
  alt.Name AS AuditType,
  u.Name AS UserName,
  al.RecordID,
  al.Description,
  al.CreatedAt AS AuditedAt
FROM [__mj].[AuditLog] al
LEFT JOIN [__mj].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
LEFT JOIN [__mj].[Entity] e ON al.EntityID = e.ID
LEFT JOIN [__mj].[User] u ON al.UserID = u.ID
WHERE e.Name = '${entity.name}'
ORDER BY al.CreatedAt DESC`;
      this.tabState.openQueryTab(connectionId, database, sql);
    }
  }

  navigateToNode(nodeId: string): void {
    this.selectedNodeId.set(nodeId);
    const node = this.nodes().find(n => n.id === nodeId);
    if (node) {
      this.onNodeSelected(node);
    }
  }

  getRelationships(node: ERDNode): ERDField[] {
    return node.fields.filter(f => f.relatedNodeId);
  }

  private async loadMJEntities(connectionId: string, database: string): Promise<void> {
    const cacheKey = `${connectionId}:${database}`;
    if (this.mjEntitiesCacheKey === cacheKey && this.mjEntitiesCache) return;

    try {
      this.mjEntitiesCache = await firstValueFrom(this.ipc.getMJEntities(connectionId, database));
      this.mjEntitiesCacheKey = cacheKey;
    } catch {
      // MJ not installed in this database — that's fine
      this.mjEntitiesCache = [];
      this.mjEntitiesCacheKey = cacheKey;
    }
  }

  private async findMJEntity(node: ERDNode): Promise<MJEntityInfo | null> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return null;

    await this.loadMJEntities(connectionId, database);
    if (!this.mjEntitiesCache) return null;

    return this.mjEntitiesCache.find(
      e => e.baseTable === node.name && e.schemaName === (node.schemaName || 'dbo')
    ) ?? null;
  }
}
