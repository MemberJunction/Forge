import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { IpcService } from '../../core/services/ipc.service';
import { ConnectionStateService } from '../../core/state/connection.state';
import { TabStateService } from '../../core/state/tab.state';
import { NotificationService } from '../../core/services/notification.service';
import { QueryHistoryStateService } from '../../core/state/query-history.state';
import { QueryResultsStateService } from '../../core/state/query-results.state';
import { AIStateService } from '../../core/state/ai.state';
import { ResultsGridComponent } from '../../shared/components/results-grid/results-grid.component';
import {
  RowDetailPanelComponent,
  RowDetailData,
} from '../../shared/components/row-detail-panel/row-detail-panel.component';
import { ResultHistoryPanelComponent } from '../../shared/components/result-history-panel/result-history-panel.component';
import { AIAnalysisPanelComponent } from '../../shared/components/ai-analysis-panel/ai-analysis-panel.component';
import type {
  QueryResult,
  ResultSet,
  QueryHistoryEntry,
  ExportFormat,
  QueryResultSnapshot,
} from '@mj-forge/shared';
import { format as formatSQL } from 'sql-formatter';

// Monaco editor types - loaded dynamically
interface MonacoEditor {
  create(element: HTMLElement, options: Record<string, unknown>): MonacoEditorInstance;
}

interface MonacoEditorInstance {
  getValue(): string;
  setValue(value: string): void;
  getSelection(): MonacoSelection | null;
  getModel(): MonacoModel | null;
  onDidChangeModelContent(callback: () => void): void;
  dispose(): void;
}

interface MonacoSelection {
  isEmpty(): boolean;
}

interface MonacoModel {
  getValueInRange(selection: MonacoSelection): string;
}

declare const monaco: { editor: MonacoEditor };

@Component({
  selector: 'app-query',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatInputModule,
    MatDividerModule,
    ResultsGridComponent,
    RowDetailPanelComponent,
    ResultHistoryPanelComponent,
    AIAnalysisPanelComponent,
  ],
  template: `
    <div class="query-container">
      <!-- Toolbar -->
      <div class="query-toolbar">
        <button
          mat-icon-button
          matTooltip="Execute (F5 or Ctrl+E)"
          [disabled]="executing()"
          (click)="executeQuery()"
        >
          @if (executing()) {
            <mat-spinner diameter="18" />
          } @else {
            <mat-icon>play_arrow</mat-icon>
          }
        </button>
        <button
          mat-icon-button
          matTooltip="Cancel"
          [disabled]="!executing()"
          (click)="cancelQuery()"
        >
          <mat-icon>stop</mat-icon>
        </button>
        <div class="toolbar-divider"></div>

        <mat-form-field appearance="outline" class="database-select">
          <mat-select
            [(ngModel)]="selectedDatabase"
            placeholder="Select Database"
            (selectionChange)="onDatabaseChange($event.value)"
          >
            @for (db of connectionState.databases(); track db.name) {
              <mat-option [value]="db.name">{{ db.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="toolbar-spacer"></div>

        <button mat-icon-button matTooltip="Query History" (click)="toggleHistory()">
          <mat-icon>history</mat-icon>
        </button>
        <button mat-icon-button matTooltip="Format SQL (⌘⇧F)" (click)="formatSql()">
          <mat-icon>auto_fix_high</mat-icon>
        </button>
        <button mat-icon-button matTooltip="Show Execution Plan" (click)="showExecutionPlan()">
          <mat-icon>account_tree</mat-icon>
        </button>

        @if (activeResultSet()) {
          <div class="toolbar-divider"></div>
          <button mat-icon-button [matMenuTriggerFor]="exportMenu" matTooltip="Export Results">
            <mat-icon>download</mat-icon>
          </button>
          <mat-menu #exportMenu="matMenu">
            <button mat-menu-item (click)="exportResults('csv')">
              <mat-icon>description</mat-icon>
              <span>Export as CSV</span>
            </button>
            <button mat-menu-item (click)="exportResults('json')">
              <mat-icon>code</mat-icon>
              <span>Export as JSON</span>
            </button>
            <button mat-menu-item (click)="exportResults('sql')">
              <mat-icon>storage</mat-icon>
              <span>Export as SQL INSERT</span>
            </button>
          </mat-menu>
        }
      </div>

      <!-- Main content area -->
      <div class="query-main">
        <!-- History panel (collapsible sidebar) -->
        @if (showHistory()) {
          <div class="history-panel">
            <div class="history-header">
              <h3>Query History</h3>
              <button mat-icon-button (click)="toggleHistory()" matTooltip="Close">
                <mat-icon>close</mat-icon>
              </button>
            </div>

            <div class="history-search">
              <mat-form-field appearance="outline" class="history-search-field">
                <mat-icon matTextPrefix>search</mat-icon>
                <input
                  matInput
                  placeholder="Search history..."
                  [(ngModel)]="historySearchText"
                  (input)="onHistorySearch()"
                />
              </mat-form-field>
            </div>

            <div class="history-list">
              @if (historyState.loading()) {
                <div class="history-loading">
                  <mat-spinner diameter="24" />
                </div>
              } @else if (historyState.entries().length === 0) {
                <div class="history-empty">
                  <mat-icon>history</mat-icon>
                  <p>No queries in history</p>
                </div>
              } @else {
                @for (entry of historyState.entries(); track entry.id) {
                  <div
                    class="history-entry"
                    [class.error]="!entry.success"
                    (click)="loadFromHistory(entry)"
                  >
                    <div class="history-entry-header">
                      <span class="history-db">{{ entry.database }}</span>
                      <span class="history-time">{{ formatHistoryTime(entry.executedAt) }}</span>
                    </div>
                    <pre class="history-sql">{{ truncateSql(entry.sql) }}</pre>
                    <div class="history-entry-footer">
                      @if (entry.success) {
                        <span class="history-rows">{{ entry.rowCount || 0 }} rows</span>
                      } @else {
                        <span class="history-error">Error</span>
                      }
                      <span class="history-duration">{{ entry.executionTimeMs }}ms</span>
                    </div>
                  </div>
                }
              }
            </div>

            @if (historyState.count() > 0) {
              <div class="history-footer">
                <button mat-button color="warn" (click)="clearHistory()">
                  <mat-icon>delete_sweep</mat-icon>
                  Clear History
                </button>
              </div>
            }
          </div>
        }

        <!-- Editor and Results -->
        <div class="query-content">
          <!-- Editor -->
          <div class="editor-pane" [style.height.%]="editorHeight()">
            <div #editorContainer class="editor-container"></div>
          </div>

          <!-- Resize handle -->
          <div class="resize-handle" (mousedown)="startResize($event)"></div>

          <!-- Results -->
          <div class="results-pane">
            @if (!result()) {
              <div class="results-placeholder">
                <mat-icon>terminal</mat-icon>
                <p>Execute a query to see results</p>
                <p class="hint">Press F5 or click the play button</p>
              </div>
            } @else if (result()?.error) {
              <div class="results-error">
                <mat-icon>error</mat-icon>
                <div class="error-content">
                  <h4>Error</h4>
                  <pre>{{ result()?.error }}</pre>
                </div>
              </div>
            } @else {
              <div class="results-tabs">
                <div class="tabs-left">
                  @for (resultSet of result()?.resultSets; track $index; let i = $index) {
                    <button
                      class="result-tab"
                      [class.active]="activeTab() === 'result-' + i"
                      (click)="setActiveTab('result-' + i)"
                    >
                      Result {{ i + 1 }}
                      <span class="row-count">({{ resultSet.rows.length }} rows)</span>
                    </button>
                  }
                  <button
                    class="result-tab"
                    [class.active]="activeTab() === 'messages'"
                    (click)="setActiveTab('messages')"
                  >
                    Messages
                  </button>
                </div>
                <div class="tabs-right">
                  @if (aiState.analysisEnabled()) {
                    <button
                      class="result-tab icon-tab"
                      [class.active]="activeTab() === 'ai'"
                      (click)="setActiveTab('ai')"
                      matTooltip="AI Analysis"
                    >
                      <mat-icon>auto_awesome</mat-icon>
                    </button>
                  }
                  @if (tabId) {
                    <button
                      class="result-tab icon-tab"
                      [class.active]="activeTab() === 'history'"
                      (click)="setActiveTab('history')"
                      matTooltip="Result History"
                    >
                      <mat-icon>history</mat-icon>
                      @if (resultsState.snapshots().length > 0) {
                        <span class="tab-badge">{{ resultsState.snapshots().length }}</span>
                      }
                    </button>
                  }
                </div>
              </div>

              @if (activeTab().startsWith('result-') && activeResultSet()) {
                <div class="results-grid">
                  <!-- Historical Result Banner -->
                  @if (viewingHistoricalResult()) {
                    <div class="historical-banner">
                      <mat-icon>history</mat-icon>
                      <div class="banner-content">
                        <span class="banner-label">Viewing Historical Result</span>
                        <span class="banner-date">{{
                          formatHistoricalDate(viewingHistoricalResult()!)
                        }}</span>
                      </div>
                      <button
                        mat-icon-button
                        matTooltip="Return to current result"
                        (click)="clearHistoricalResult()"
                      >
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                  }
                  <app-results-grid
                    [resultSet]="activeResultSet()"
                    [connectionId]="connectionState.activeConnectionId()"
                    [database]="selectedDatabase"
                    [class.historical]="viewingHistoricalResult()"
                    (cellSelected)="onCellSelected($event)"
                    (exportRequested)="exportResults($event)"
                    (openQueryRequested)="openQueryInNewTab($event)"
                  />
                </div>
              } @else if (activeTab() === 'messages') {
                <div class="messages-pane">
                  <pre>{{ result()?.messages?.join('\\n') || 'Query executed successfully.' }}</pre>
                  @if (result()?.rowsAffected !== undefined) {
                    <p class="rows-affected">({{ result()?.rowsAffected }} rows affected)</p>
                  }
                  <p class="execution-time">Execution time: {{ result()?.executionTime }}ms</p>
                </div>
              } @else if (activeTab() === 'ai') {
                <div class="tab-content-pane">
                  <app-ai-analysis-panel
                    [sql]="getLastExecutedSql()"
                    [resultSet]="getFirstResultSet()"
                    [databaseName]="selectedDatabase ?? ''"
                    [embedded]="true"
                  />
                </div>
              } @else if (activeTab() === 'history' && tabId) {
                <div class="tab-content-pane">
                  <app-result-history-panel
                    [tabId]="tabId"
                    [connectionId]="connectionState.activeConnectionId() ?? undefined"
                    [database]="selectedDatabase ?? undefined"
                    [embedded]="true"
                    (viewResult)="onViewHistoryResult($event)"
                    (compareResults)="onCompareResults($event)"
                  />
                </div>
              }
            }
          </div>
        </div>
      </div>

      <!-- Row Detail Panel -->
      <app-row-detail-panel
        [inputData]="rowDetailData()"
        [totalRows]="activeResultSet()?.rows?.length ?? 0"
        [connectionId]="connectionState.activeConnectionId()"
        [database]="selectedDatabase"
        (closed)="closeRowDetail()"
        (navigateRow)="navigateRowDetail($event)"
        (openQueryRequested)="openQueryInNewTab($event)"
      />
    </div>
  `,
  styles: [
    `
      .query-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .query-toolbar {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
      }

      .toolbar-divider {
        width: 1px;
        height: 24px;
        background-color: var(--border-primary);
        margin: 0 var(--spacing-xs);
      }

      .toolbar-spacer {
        flex: 1;
      }

      .database-select {
        width: 200px;

        ::ng-deep .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      .query-main {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      .history-panel {
        width: 320px;
        border-right: 1px solid var(--border-primary);
        display: flex;
        flex-direction: column;
        background-color: var(--bg-secondary);
      }

      .history-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);

        h3 {
          margin: 0;
          font-size: var(--font-size-md);
          font-weight: 600;
        }
      }

      .history-search {
        padding: var(--spacing-sm);
        border-bottom: 1px solid var(--border-primary);
      }

      .history-search-field {
        width: 100%;

        ::ng-deep .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      .history-list {
        flex: 1;
        overflow-y: auto;
      }

      .history-loading,
      .history-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.5;
          margin-bottom: var(--spacing-sm);
        }

        p {
          margin: 0;
        }
      }

      .history-entry {
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        &.error {
          border-left: 3px solid var(--status-error);
        }
      }

      .history-entry-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: var(--spacing-xs);
        font-size: var(--font-size-xs);
      }

      .history-db {
        color: var(--text-primary);
        font-weight: 500;
      }

      .history-time {
        color: var(--text-muted);
      }

      .history-sql {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 60px;
        overflow: hidden;
      }

      .history-entry-footer {
        display: flex;
        justify-content: space-between;
        margin-top: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }

      .history-error {
        color: var(--status-error);
      }

      .history-footer {
        padding: var(--spacing-sm);
        border-top: 1px solid var(--border-primary);
        text-align: center;
      }

      .query-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .editor-pane {
        min-height: 100px;
        overflow: hidden;
      }

      .editor-container {
        width: 100%;
        height: 100%;
      }

      .resize-handle {
        height: 4px;
        background-color: var(--border-primary);
        cursor: row-resize;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--border-focus);
        }
      }

      .results-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 100px;
      }

      .results-placeholder {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.5;
          margin-bottom: var(--spacing-md);
        }

        p {
          margin: 0;
        }

        .hint {
          font-size: var(--font-size-sm);
          margin-top: var(--spacing-xs);
        }
      }

      .results-error {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background-color: rgba(244, 67, 54, 0.1);
        border-left: 3px solid var(--status-error);
        margin: var(--spacing-md);

        mat-icon {
          color: var(--status-error);
        }

        .error-content {
          flex: 1;

          h4 {
            margin: 0 0 var(--spacing-xs);
            color: var(--status-error);
          }

          pre {
            margin: 0;
            font-family: var(--font-mono);
            font-size: var(--font-size-sm);
            white-space: pre-wrap;
            color: var(--text-primary);
          }
        }
      }

      .results-tabs {
        display: flex;
        justify-content: space-between;
        background-color: var(--border-primary);
        border-bottom: 1px solid var(--border-primary);
      }

      .tabs-left,
      .tabs-right {
        display: flex;
        gap: 1px;
      }

      .result-tab {
        padding: var(--spacing-xs) var(--spacing-md);
        background-color: var(--bg-secondary);
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: var(--font-size-sm);
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        &.active {
          background-color: var(--bg-primary);
          color: var(--text-primary);
        }

        &.icon-tab {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-sm);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }

        .row-count {
          color: var(--text-muted);
          margin-left: var(--spacing-xs);
        }

        .tab-badge {
          background-color: var(--accent-primary);
          color: white;
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 8px;
          min-width: 14px;
          text-align: center;
        }
      }

      .tab-content-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: auto;
        min-height: 0;
      }

      .results-grid {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .historical-banner {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-md);
        background: linear-gradient(90deg, rgba(156, 39, 176, 0.15), rgba(103, 58, 183, 0.15));
        border-bottom: 2px solid rgba(156, 39, 176, 0.5);
        color: var(--text-primary);

        > mat-icon {
          color: #9c27b0;
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        .banner-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .banner-label {
          font-size: var(--font-size-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #9c27b0;
        }

        .banner-date {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }

        button {
          width: 24px;
          height: 24px;

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }
      }

      app-results-grid.historical {
        border-left: 3px solid rgba(156, 39, 176, 0.5);
      }

      .messages-pane {
        flex: 1;
        padding: var(--spacing-md);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        overflow: auto;

        pre {
          margin: 0;
          white-space: pre-wrap;
        }

        .rows-affected,
        .execution-time {
          margin: var(--spacing-sm) 0 0;
          color: var(--text-secondary);
        }
      }
    `,
  ],
})
export class QueryComponent implements OnInit, OnDestroy {
  @ViewChild('editorContainer', { static: true })
  editorContainer!: ElementRef<HTMLDivElement>;

  private readonly ipc = inject(IpcService);
  readonly connectionState = inject(ConnectionStateService);
  readonly tabState = inject(TabStateService);
  private readonly notification = inject(NotificationService);
  readonly historyState = inject(QueryHistoryStateService);
  readonly resultsState = inject(QueryResultsStateService);
  readonly aiState = inject(AIStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  private editor?: MonacoEditorInstance;
  private resizing = false;

  /**
   * The tab ID this component instance is bound to.
   * Set by GoldenLayoutContainer when creating the component.
   * This is the KEY to tab isolation - each component only manages its own tab.
   */
  tabId: string | null = null;

  selectedDatabase: string | null = null;
  executing = signal(false);
  result = signal<QueryResult | null>(null);
  activeTab = signal('result-0');
  editorHeight = signal(50);
  showHistory = signal(false);
  historySearchText = '';

  // Row detail panel state
  rowDetailData = signal<RowDetailData | null>(null);
  showRowDetail = signal(false);

  // Track last executed SQL for AI analysis
  private lastExecutedSql = '';

  // Track when viewing historical results (not the current execution)
  viewingHistoricalResult = signal<QueryResultSnapshot | null>(null);

  private currentQueryId: string | null = null;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Watch for THIS component's tab becoming active to sync editor content
    effect(
      () => {
        const activeTab = this.tabState.activeTab();
        // Only act if this component's tab is now active
        if (activeTab?.type === 'query' && this.tabId && activeTab.id === this.tabId) {
          // Update database selection
          if (activeTab.databaseName) {
            this.selectedDatabase = activeTab.databaseName;
            this.connectionState.selectDatabase(activeTab.databaseName);
          }

          // Update editor content when it's ready
          if (this.editor && activeTab.content !== undefined) {
            const currentValue = this.editor.getValue();
            // Only update if content differs (prevents cursor jump)
            if (currentValue !== activeTab.content) {
              this.editor.setValue(activeTab.content || '');
            }
          }

          // Auto-execute if flag is set
          if (activeTab.autoExecute && activeTab.content) {
            // Clear the flag first to prevent re-execution
            this.tabState.clearAutoExecute(activeTab.id);
            // Execute after editor is ready with content
            this.executeWhenEditorReady(activeTab.content);
          }
        }
      },
      { allowSignalWrites: true }
    );

    // Watch for external database selection changes (e.g. sidebar dropdown)
    effect(() => {
      const db = this.connectionState.selectedDatabase();
      if (db && db !== this.selectedDatabase) {
        this.selectedDatabase = db;
        // Also update the tab's stored databaseName to prevent the active-tab
        // effect from reverting the selection
        if (this.tabId) {
          this.tabState.updateTab(this.tabId, { databaseName: db });
        }
        this.cdr.markForCheck();
      }
    });
  }

  ngOnInit(): void {
    this.initMonaco();
    this.selectedDatabase = this.connectionState.selectedDatabase();

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', this.handleKeydown);
  }

  ngOnDestroy(): void {
    this.editor?.dispose();
    document.removeEventListener('keydown', this.handleKeydown);
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    // Only respond to shortcuts if THIS component's tab is active
    const activeTab = this.tabState.activeTab();
    if (!this.tabId || activeTab?.id !== this.tabId) {
      return;
    }

    // F5 - Execute query
    if (event.key === 'F5') {
      event.preventDefault();
      this.executeQuery();
      return;
    }
    // Cmd+Shift+F - Format SQL
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.formatSql();
      return;
    }
    // Cmd+Enter - Execute query (alternative)
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      this.executeQuery();
      return;
    }
    // Ctrl+E - Execute query (SSMS-style shortcut)
    // Note: Uses ctrlKey specifically, not metaKey, to match SSMS behavior
    if (event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'e') {
      event.preventDefault();
      this.executeQuery();
      return;
    }
  };

  private initMonaco(): void {
    // Monaco loader - use singleton pattern to prevent duplicate loading
    const win = window as unknown as {
      _monacoLoading?: Promise<void>;
      _monacoLoaded?: boolean;
      require?: {
        config: (config: Record<string, unknown>) => void;
        (modules: string[], callback: () => void): void;
      };
    };

    // If Monaco is already loaded, create editor immediately
    if (typeof monaco !== 'undefined' || win._monacoLoaded) {
      this.createEditor();
      return;
    }

    // If Monaco is currently loading, wait for it
    if (win._monacoLoading) {
      win._monacoLoading.then(() => this.createEditor());
      return;
    }

    // Start loading Monaco (singleton)
    win._monacoLoading = new Promise<void>(resolve => {
      // Check if loader script already exists
      const existingScript = document.querySelector('script[src*="monaco/vs/loader.js"]');
      if (existingScript) {
        // Loader exists but may still be loading - check if require is available
        const checkRequire = () => {
          if (win.require) {
            win.require.config({ paths: { vs: 'assets/monaco/vs' } });
            win.require(['vs/editor/editor.main'], () => {
              win._monacoLoaded = true;
              resolve();
            });
          } else {
            setTimeout(checkRequire, 50);
          }
        };
        checkRequire();
        return;
      }

      // Dynamically load Monaco from assets
      const script = document.createElement('script');
      script.src = 'assets/monaco/vs/loader.js';
      script.onload = () => {
        if (win.require) {
          win.require.config({ paths: { vs: 'assets/monaco/vs' } });
          win.require(['vs/editor/editor.main'], () => {
            win._monacoLoaded = true;
            resolve();
          });
        }
      };
      document.body.appendChild(script);
    });

    win._monacoLoading.then(() => this.createEditor());
  }

  private createEditor(): void {
    this.editor = monaco.editor.create(this.editorContainer.nativeElement, {
      value: '',
      language: 'sql',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      insertSpaces: true,
      renderWhitespace: 'selection',
    });

    // Listen for content changes - use this.tabId for isolation
    this.editor.onDidChangeModelContent(() => {
      const content = this.editor?.getValue() || '';
      // Use the fixed tabId this component was created for
      // This prevents writes to wrong tabs when switching quickly
      if (this.tabId) {
        this.tabState.setTabContent(this.tabId, content);
      }
    });

    // Load existing content from this component's tab
    if (this.tabId) {
      const tab = this.tabState.tabs().find(t => t.id === this.tabId);
      if (tab?.type === 'query') {
        if (tab.content) {
          this.editor.setValue(tab.content);
        }
        // Handle auto-execute for initial load
        if (tab.autoExecute && tab.content) {
          this.tabState.clearAutoExecute(tab.id);
          // Execute immediately since editor is ready and content is set
          this.executeQuery();
        }
      }
    } else {
      // Fallback for components created without tabId (legacy path)
      const activeTab = this.tabState.activeTab();
      if (activeTab?.type === 'query') {
        this.tabId = activeTab.id; // Capture the tab ID
        if (activeTab.content) {
          this.editor.setValue(activeTab.content);
        }
        if (activeTab.autoExecute && activeTab.content) {
          this.tabState.clearAutoExecute(activeTab.id);
          this.executeQuery();
        }
      }
    }
  }

  async executeQuery(): Promise<void> {
    const sql = this.getSelectedOrAllText();
    if (!sql.trim()) {
      this.notification.warning('No query to execute');
      return;
    }

    const connectionId = this.connectionState.activeConnectionId();
    const database = this.selectedDatabase;

    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    this.executing.set(true);
    this.result.set(null);
    this.viewingHistoricalResult.set(null); // Clear any historical result view
    this.currentQueryId = `query-${Date.now()}`;
    this.lastExecutedSql = sql;

    try {
      const result = await this.ipc
        .executeQuery({
          connectionId,
          database: database || undefined,
          sql,
          queryId: this.currentQueryId,
        })
        .toPromise();

      this.result.set(result ?? null);
      this.activeTab.set(result?.resultSets?.length ? 'result-0' : 'messages');

      // Refresh history if panel is open
      if (this.showHistory()) {
        this.historyState.loadHistory();
      }

      // Auto-save result snapshot - use this.tabId for correct tab
      if (result && this.tabId && connectionId && database) {
        this.resultsState.saveSnapshot(this.tabId, sql, connectionId, database, result);
      }

      // Auto-rename tab after successful execution
      if (result?.success && this.tabId) {
        if (this.aiState.autoRenameEnabled()) {
          this.autoRenameTab(this.tabId, sql, database ?? undefined);
        } else {
          // Simple SQL-based rename: extract table/proc name from SQL
          this.updateTabTitleFromSql(this.tabId, sql);
        }
      }
    } catch (error) {
      this.result.set({
        queryId: this.currentQueryId,
        success: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
        executionTime: 0,
      });
    } finally {
      this.executing.set(false);
      this.currentQueryId = null;
    }
  }

  async cancelQuery(): Promise<void> {
    if (this.currentQueryId) {
      await this.ipc.cancelQuery(this.currentQueryId).toPromise();
      this.notification.info('Query cancelled');
    }
  }

  onDatabaseChange(database: string): void {
    this.connectionState.selectDatabase(database);
    // Update the tab's stored databaseName so the active-tab effect
    // doesn't revert the selection back to the old value
    if (this.tabId) {
      this.tabState.updateTab(this.tabId, { databaseName: database });
    }
  }

  // History panel methods
  toggleHistory(): void {
    const newState = !this.showHistory();
    this.showHistory.set(newState);
    if (newState) {
      this.historyState.loadHistory();
    }
  }

  onHistorySearch(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.historyState.search(this.historySearchText);
    }, 300);
  }

  loadFromHistory(entry: QueryHistoryEntry): void {
    if (this.editor) {
      this.editor.setValue(entry.sql);
    }
    // Optionally switch to the database from history
    if (entry.database && entry.database !== this.selectedDatabase) {
      this.selectedDatabase = entry.database;
      this.connectionState.selectDatabase(entry.database);
    }
    this.notification.info('Query loaded from history');
  }

  async clearHistory(): Promise<void> {
    try {
      await this.historyState.clearHistory();
      this.notification.success('History cleared');
    } catch {
      this.notification.error('Failed to clear history');
    }
  }

  formatHistoryTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  truncateSql(sql: string): string {
    const maxLength = 150;
    const cleaned = sql.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength) + '...';
  }

  // Export methods
  async exportResults(format: ExportFormat): Promise<void> {
    const resultSet = this.activeResultSet();
    if (!resultSet) {
      this.notification.warning('No results to export');
      return;
    }

    try {
      const result = await this.ipc
        .exportQueryResults(resultSet, {
          format,
          includeHeaders: true,
          prettyPrint: true,
          tableName: 'QueryResults',
        })
        .toPromise();

      if (result?.success) {
        this.notification.success(`Exported ${result.rowsExported} rows to ${result.filePath}`);
      } else if (result?.error && result.error !== 'Export cancelled') {
        this.notification.error(`Export failed: ${result.error}`);
      }
    } catch (error) {
      this.notification.error('Export failed');
    }
  }

  startResize(event: MouseEvent): void {
    this.resizing = true;
    const startY = event.clientY;
    const startHeight = this.editorHeight();

    const onMouseMove = (e: MouseEvent) => {
      if (!this.resizing) return;
      const delta = e.clientY - startY;
      const containerHeight =
        this.editorContainer.nativeElement.parentElement?.parentElement?.clientHeight || 600;
      const newHeight = startHeight + (delta / containerHeight) * 100;
      this.editorHeight.set(Math.max(10, Math.min(90, newHeight)));
    };

    const onMouseUp = () => {
      this.resizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  activeResultSet(): ResultSet | null {
    const r = this.result();
    const tab = this.activeTab();
    if (!tab.startsWith('result-')) return null;
    const idx = parseInt(tab.replace('result-', ''), 10);
    return r?.resultSets?.[idx] ?? null;
  }

  getFirstResultSet(): ResultSet | null {
    return this.result()?.resultSets?.[0] ?? null;
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }

  private getSelectedOrAllText(): string {
    if (!this.editor) return '';
    const selection = this.editor.getSelection();
    if (selection && !selection.isEmpty()) {
      return this.editor.getModel()?.getValueInRange(selection) || '';
    }
    return this.editor.getValue();
  }

  /**
   * Execute query when editor is ready with the expected content.
   * Polls until editor is available and has the content loaded.
   */
  private executeWhenEditorReady(expectedContent: string, maxAttempts = 20): void {
    let attempts = 0;
    const checkAndExecute = (): void => {
      attempts++;
      if (this.editor && this.editor.getValue() === expectedContent) {
        // Editor is ready with correct content - execute
        this.executeQuery();
      } else if (attempts < maxAttempts) {
        // Try again after a short delay
        setTimeout(checkAndExecute, 50);
      } else {
        // Give up after max attempts, try anyway
        if (this.editor) {
          this.executeQuery();
        }
      }
    };
    // Start checking after a brief delay
    setTimeout(checkAndExecute, 50);
  }

  // Row detail panel methods
  onCellSelected(event: { row: number; column: string; value: unknown }): void {
    const resultSet = this.activeResultSet();
    if (!resultSet) return;

    this.rowDetailData.set({
      rowIndex: event.row,
      row: resultSet.rows[event.row],
      columns: resultSet.columns,
    });
    this.showRowDetail.set(true);
  }

  closeRowDetail(): void {
    this.showRowDetail.set(false);
    this.rowDetailData.set(null);
  }

  navigateRowDetail(direction: 'next' | 'previous'): void {
    const resultSet = this.activeResultSet();
    const currentData = this.rowDetailData();
    if (!resultSet || !currentData) return;

    const newIndex = direction === 'next' ? currentData.rowIndex + 1 : currentData.rowIndex - 1;

    if (newIndex >= 0 && newIndex < resultSet.rows.length) {
      this.rowDetailData.set({
        rowIndex: newIndex,
        row: resultSet.rows[newIndex],
        columns: resultSet.columns,
      });
    }
  }

  // SQL Formatting
  formatSql(): void {
    if (!this.editor) {
      this.notification.warning('Editor not ready');
      return;
    }

    const sql = this.editor.getValue();
    if (!sql.trim()) {
      this.notification.warning('No SQL to format');
      return;
    }

    try {
      const formatted = formatSQL(sql, {
        language: 'tsql',
        tabWidth: 2,
        useTabs: false,
        keywordCase: 'upper',
        dataTypeCase: 'upper',
        functionCase: 'upper',
        linesBetweenQueries: 2,
      });
      this.editor.setValue(formatted);
      this.notification.success('SQL formatted');
    } catch (error) {
      this.notification.error('Failed to format SQL');
      console.error('SQL formatting error:', error);
    }
  }

  // Show Execution Plan (placeholder for now)
  showExecutionPlan(): void {
    this.notification.info('Execution plan visualization coming soon');
  }

  // Get last executed SQL for AI analysis
  getLastExecutedSql(): string {
    return this.lastExecutedSql;
  }

  // View a historical result snapshot
  onViewHistoryResult(snapshot: QueryResultSnapshot): void {
    // Create a QueryResult from the snapshot to display
    if (snapshot.resultSets && snapshot.resultSets.length > 0) {
      this.viewingHistoricalResult.set(snapshot);
      this.result.set({
        queryId: snapshot.id,
        success: snapshot.success,
        resultSets: snapshot.resultSets,
        executionTime: snapshot.executionTimeMs,
        error: snapshot.error,
      });
      this.activeTab.set('result-0');
      this.lastExecutedSql = snapshot.sql;
    }
  }

  // Clear historical result and return to showing nothing
  clearHistoricalResult(): void {
    this.viewingHistoricalResult.set(null);
    this.result.set(null);
  }

  // Format date for historical result banner
  formatHistoricalDate(snapshot: QueryResultSnapshot): string {
    const date = new Date(snapshot.executedAt);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  // Compare two result snapshots (now handled inline in history panel)
  onCompareResults(_comparison: { base: QueryResultSnapshot; compare: QueryResultSnapshot }): void {
    // Comparison is now handled inline in the result history panel
    // This method is kept for backward compatibility but no longer does anything
  }

  /**
   * Update tab title from SQL content (non-AI fallback).
   * Extracts table/procedure name for a concise title.
   */
  private updateTabTitleFromSql(tabId: string, sql: string): void {
    const cleaned = sql.replace(/\s+/g, ' ').trim();

    // SELECT ... FROM [schema].[table]
    const selectMatch = cleaned.match(
      /^SELECT\b.*?\bFROM\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i
    );
    if (selectMatch) {
      const table = selectMatch[2];
      const title = table.length > 20 ? `${table.substring(0, 18)}…` : table;
      this.tabState.renameTab(tabId, title);
      return;
    }

    // EXEC [schema].[proc]
    const execMatch = cleaned.match(
      /^EXEC(?:UTE)?\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i
    );
    if (execMatch) {
      const proc = execMatch[2];
      this.tabState.renameTab(tabId, `Exec ${proc.length > 16 ? proc.substring(0, 14) + '…' : proc}`);
      return;
    }

    // For other SQL, use a short preview
    if (cleaned.length > 5) {
      const preview = cleaned.substring(0, 22);
      this.tabState.renameTab(tabId, preview.length < cleaned.length ? `${preview}…` : preview);
    }
  }

  // Auto-rename tab using AI
  private async autoRenameTab(tabId: string, sql: string, database?: string): Promise<void> {
    try {
      const response = await this.aiState.generateTabName({
        sql,
        database,
      });

      if (response?.suggestedName) {
        this.tabState.renameTab(tabId, response.suggestedName);
      }
    } catch (error) {
      // Silent fail - tab renaming is non-critical
      console.debug('Auto-rename tab failed:', error);
    }
  }

  // Open a query in a new tab (from FK navigation)
  openQueryInNewTab(query: { sql: string; title: string }): void {
    const connectionId = this.connectionState.activeConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    // Create a new query tab with the SQL and auto-execute it
    const tabId = this.tabState.openQueryTab(
      connectionId,
      this.selectedDatabase ?? '',
      query.sql,
      true // autoExecute
    );

    // Rename the tab to use the FK table/value title
    if (query.title) {
      this.tabState.renameTab(tabId, query.title);
    }
  }
}
