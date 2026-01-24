import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  CellClickedEvent,
  CellContextMenuEvent,
  ValueFormatterParams,
  CellClassParams,
  ModuleRegistry,
  AllCommunityModule,
} from 'ag-grid-community';
import type { ResultSet, ColumnMetadata } from '@mj-forge/shared';
import { NotificationService } from '../../../core/services/notification.service';
import { IpcService } from '../../../core/services/ipc.service';
import { firstValueFrom } from 'rxjs';

interface ColumnStats {
  column: string;
  type: string;
  nullCount: number;
  distinctCount: number;
  minValue?: unknown;
  maxValue?: unknown;
  avgValue?: number;
}

// Register all community modules
ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-results-grid',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    AgGridAngular,
  ],
  template: `
    <div class="results-grid-container">
      <div class="grid-toolbar">
        <div class="grid-info">
          <span class="row-count">{{ rowCount() }} rows</span>
          @if (selectedCount() > 0) {
            <span class="selection-info">{{ selectedCount() }} selected</span>
          }
          @if (filterText()) {
            <span class="filter-info">filtered</span>
          }
        </div>

        <div class="grid-search">
          <input
            type="text"
            placeholder="Quick filter..."
            [ngModel]="filterText()"
            (ngModelChange)="onFilterChange($event)"
          />
          @if (filterText()) {
            <button class="clear-btn" (click)="clearFilter()">
              <mat-icon>close</mat-icon>
            </button>
          }
        </div>

        <div class="grid-actions">
          <button
            class="grid-btn"
            matTooltip="Column Statistics"
            (click)="toggleStats()"
            [class.active]="showStats()"
          >
            <mat-icon>analytics</mat-icon>
          </button>
          <button class="grid-btn" matTooltip="Auto-size columns" (click)="autoSizeAllColumns()">
            <mat-icon>view_column</mat-icon>
          </button>
          <button
            class="grid-btn"
            matTooltip="Copy selected (Ctrl+C)"
            (click)="copySelectedToClipboard()"
          >
            <mat-icon>content_copy</mat-icon>
          </button>
          <button class="grid-btn" [matMenuTriggerFor]="exportMenu" matTooltip="Export">
            <mat-icon>download</mat-icon>
          </button>

          <mat-menu #exportMenu="matMenu">
            <button mat-menu-item (click)="exportCsv()">
              <mat-icon>description</mat-icon>
              <span>Export as CSV</span>
            </button>
            <button mat-menu-item (click)="exportJson()">
              <mat-icon>code</mat-icon>
              <span>Export as JSON</span>
            </button>
            <button mat-menu-item (click)="exportSqlInsert()">
              <mat-icon>storage</mat-icon>
              <span>Export as SQL INSERT</span>
            </button>
            <button mat-menu-item (click)="copySelectedToClipboard(true)">
              <mat-icon>table_chart</mat-icon>
              <span>Copy with Headers</span>
            </button>
          </mat-menu>
        </div>
      </div>

      <!-- Column Statistics Panel -->
      @if (showStats()) {
        <div class="stats-panel">
          <div class="stats-header">
            <h4>Column Statistics</h4>
            <button class="close-btn" (click)="showStats.set(false)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="stats-content">
            @for (stat of columnStats(); track stat.column) {
              <div class="stat-item">
                <div class="stat-name">{{ stat.column }}</div>
                <div class="stat-details">
                  <span class="stat-type">{{ stat.type }}</span>
                  <span>{{ stat.distinctCount }} distinct</span>
                  <span>{{ stat.nullCount }} nulls</span>
                  @if (stat.minValue !== undefined) {
                    <span>min: {{ stat.minValue }}</span>
                  }
                  @if (stat.maxValue !== undefined) {
                    <span>max: {{ stat.maxValue }}</span>
                  }
                  @if (stat.avgValue !== undefined) {
                    <span>avg: {{ stat.avgValue | number: '1.2-2' }}</span>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }

      <div class="grid-wrapper">
        <ag-grid-angular
          class="ag-theme-quartz-dark"
          [theme]="'legacy'"
          [rowData]="rowData"
          [columnDefs]="columnDefs"
          [defaultColDef]="defaultColDef"
          [rowSelection]="rowSelectionOptions"
          [suppressClipboardPaste]="true"
          [animateRows]="false"
          [suppressRowHoverHighlight]="false"
          [rowBuffer]="20"
          [quickFilterText]="filterText()"
          [enableCellTextSelection]="true"
          (gridReady)="onGridReady($event)"
          (cellClicked)="onCellClicked($event)"
          (cellContextMenu)="onCellContextMenu($event)"
          (selectionChanged)="onSelectionChanged()"
        />
      </div>

      <!-- Cell Value Preview Panel -->
      @if (selectedCell()) {
        <div class="preview-panel">
          <div class="preview-header">
            <span class="preview-column">{{ selectedCell()!.column }}</span>
            <span class="preview-type">{{ selectedCell()!.type }}</span>
            <button class="close-btn" (click)="selectedCell.set(null)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="preview-content">
            <pre>{{ formatPreviewValue(selectedCell()!.value) }}</pre>
          </div>
          <div class="preview-actions">
            <button class="action-btn" (click)="copyPreviewValue()">
              <mat-icon>content_copy</mat-icon>
              Copy
            </button>
          </div>
        </div>
      }

      <!-- Context Menu -->
      @if (contextMenuPosition()) {
        <div
          class="context-menu"
          [style.top.px]="contextMenuPosition()!.y"
          [style.left.px]="contextMenuPosition()!.x"
          (mouseleave)="closeContextMenu()"
        >
          <button class="menu-item" (click)="copyCellValue()">
            <mat-icon>content_copy</mat-icon>
            Copy Cell Value
          </button>
          <button class="menu-item" (click)="copyRowAsJson()">
            <mat-icon>code</mat-icon>
            Copy Row as JSON
          </button>
          <button class="menu-item" (click)="copyRowAsSql()">
            <mat-icon>storage</mat-icon>
            Copy as INSERT
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" (click)="filterByValue()">
            <mat-icon>filter_alt</mat-icon>
            Filter by Value
          </button>
          <button class="menu-item" (click)="excludeValue()">
            <mat-icon>filter_alt_off</mat-icon>
            Exclude Value
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .results-grid-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        position: relative;
      }

      .grid-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        background-color: var(--bg-tertiary);
        border-bottom: 1px solid var(--border-primary);
        min-height: 36px;
        gap: 12px;
      }

      .grid-info {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        color: var(--text-secondary);
        flex-shrink: 0;
      }

      .row-count {
        color: var(--text-primary);
      }

      .selection-info {
        color: var(--status-info);
      }

      .filter-info {
        color: var(--status-warning);
      }

      .grid-search {
        flex: 1;
        max-width: 300px;
        position: relative;

        input {
          width: 100%;
          padding: 4px 28px 4px 8px;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: 4px;
          color: var(--text-primary);
          font-size: 12px;

          &:focus {
            outline: none;
            border-color: var(--border-focus);
          }

          &::placeholder {
            color: var(--text-muted);
          }
        }

        .clear-btn {
          position: absolute;
          right: 4px;
          top: 50%;
          transform: translateY(-50%);
          width: 20px;
          height: 20px;
          padding: 0;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;

          mat-icon {
            font-size: 14px;
            width: 14px;
            height: 14px;
          }

          &:hover {
            color: var(--text-primary);
          }
        }
      }

      .grid-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
      }

      .grid-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }

        &:active {
          background-color: var(--bg-active);
        }

        &.active {
          background-color: var(--status-info);
          color: white;
        }
      }

      .grid-wrapper {
        flex: 1;
        overflow: hidden;
      }

      ag-grid-angular {
        width: 100%;
        height: 100%;
      }

      /* Stats Panel */
      .stats-panel {
        background-color: var(--bg-secondary);
        border-bottom: 1px solid var(--border-primary);
        max-height: 200px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .stats-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border-primary);

        h4 {
          margin: 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
        }
      }

      .stats-content {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
      }

      .stat-item {
        padding: 8px;
        background-color: var(--bg-tertiary);
        border-radius: 4px;

        .stat-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 4px;
        }

        .stat-details {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 11px;
          color: var(--text-secondary);

          .stat-type {
            color: var(--status-info);
          }
        }
      }

      /* Preview Panel */
      .preview-panel {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background-color: var(--bg-secondary);
        border-top: 1px solid var(--border-primary);
        max-height: 150px;
        display: flex;
        flex-direction: column;
        z-index: 100;
      }

      .preview-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--border-primary);

        .preview-column {
          font-weight: 600;
          color: var(--text-primary);
        }

        .preview-type {
          font-size: 11px;
          color: var(--text-muted);
          padding: 2px 6px;
          background-color: var(--bg-tertiary);
          border-radius: 4px;
        }
      }

      .preview-content {
        flex: 1;
        overflow: auto;
        padding: 8px 12px;

        pre {
          margin: 0;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-all;
        }
      }

      .preview-actions {
        display: flex;
        gap: 4px;
        padding: 6px 12px;
        border-top: 1px solid var(--border-primary);
      }

      .action-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: transparent;
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        color: var(--text-secondary);
        font-size: 11px;
        cursor: pointer;

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }
      }

      .close-btn {
        width: 24px;
        height: 24px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--text-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-left: auto;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }
      }

      /* Context Menu */
      .context-menu {
        position: fixed;
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
        box-shadow: var(--shadow-md);
        min-width: 180px;
        z-index: 10000;
        padding: 4px 0;
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        background: transparent;
        border: none;
        color: var(--text-primary);
        font-size: 12px;
        cursor: pointer;
        text-align: left;

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          color: var(--text-secondary);
        }

        &:hover {
          background-color: var(--bg-hover);
        }
      }

      .menu-divider {
        height: 1px;
        background-color: var(--border-primary);
        margin: 4px 0;
      }

      /* Custom ag-Grid theme overrides for dark mode */
      :host ::ng-deep .ag-theme-quartz-dark {
        --ag-background-color: var(--bg-primary);
        --ag-header-background-color: var(--grid-header-bg);
        --ag-odd-row-background-color: var(--grid-row-odd);
        --ag-even-row-background-color: var(--grid-row-even);
        --ag-row-hover-color: var(--grid-row-hover);
        --ag-selected-row-background-color: var(--grid-row-selected);
        --ag-range-selection-background-color: var(--grid-range-selection);
        --ag-range-selection-border-color: var(--grid-range-border);
        --ag-header-foreground-color: var(--text-secondary);
        --ag-foreground-color: var(--text-primary);
        --ag-border-color: var(--border-primary);
        --ag-secondary-foreground-color: var(--text-muted);
        --ag-font-family: 'JetBrains Mono', 'Consolas', monospace;
        --ag-font-size: 12px;
        --ag-row-height: 24px;
        --ag-header-height: 32px;
        --ag-cell-horizontal-padding: 8px;

        /* Checkbox styling for dark/light mode */
        --ag-checkbox-background-color: var(--bg-tertiary);
        --ag-checkbox-checked-color: var(--status-info);
        --ag-checkbox-unchecked-color: var(--border-secondary);
        --ag-checkbox-indeterminate-color: var(--status-info);

        /* Input styling */
        --ag-input-border-color: var(--border-primary);
        --ag-input-focus-border-color: var(--border-focus);
        --ag-input-disabled-background-color: var(--bg-secondary);

        /* Icon colors */
        --ag-icon-font-color: var(--text-secondary);

        /* Popup/modal backgrounds */
        --ag-modal-overlay-background-color: rgba(0, 0, 0, 0.5);
        --ag-popup-background-color: var(--bg-elevated);

        .ag-root-wrapper {
          border: none;
        }

        .ag-header {
          border-bottom: 1px solid var(--border-primary);
        }

        .ag-header-cell {
          font-weight: 600;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .ag-header-cell-text {
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ag-cell {
          border-right: 1px solid var(--grid-cell-border);
          line-height: 24px;
        }

        .ag-row {
          border-bottom: 1px solid var(--grid-cell-border);
        }

        .ag-cell.cell-null {
          color: var(--text-muted);
          font-style: italic;
        }

        .ag-cell.cell-number {
          text-align: right;
        }

        .ag-cell.cell-boolean {
          color: var(--status-info);
        }

        .ag-cell.cell-date {
          color: var(--status-warning);
        }

        /* Row number column */
        .ag-cell.row-number-cell {
          background-color: var(--grid-header-bg);
          color: var(--text-muted);
          text-align: right;
          font-size: 10px;
          border-right: 1px solid var(--border-primary);
        }

        /* Context menu styling */
        .ag-menu {
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-primary);
          box-shadow: var(--shadow-md);
        }

        .ag-menu-option {
          padding: 8px 12px;
          cursor: pointer;

          &:hover {
            background-color: var(--bg-hover);
          }
        }

        .ag-menu-option-text {
          font-size: 12px;
        }

        /* Scrollbar styling */
        ::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }

        ::-webkit-scrollbar-track {
          background: var(--bg-primary);
        }

        ::-webkit-scrollbar-thumb {
          background: var(--border-secondary);
          border-radius: 5px;

          &:hover {
            background: var(--text-muted);
          }
        }

        /* Filter styling */
        .ag-filter {
          background-color: var(--bg-secondary);
          border: 1px solid var(--border-primary);
        }

        .ag-filter-body-wrapper {
          padding: 8px;
        }

        .ag-text-field-input {
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);
          padding: 4px 8px;
          border-radius: 4px;

          &:focus {
            border-color: var(--border-focus);
            outline: none;
          }
        }

        /* Checkbox styling */
        .ag-checkbox-input-wrapper {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-secondary);
          border-radius: 3px;

          &::after {
            color: var(--status-info);
          }

          &.ag-checked {
            background-color: var(--status-info);
            border-color: var(--status-info);

            &::after {
              color: white;
            }
          }

          &:hover {
            border-color: var(--status-info);
          }
        }

        /* Input elements in ag-Grid */
        input[class^='ag-'],
        input[class*=' ag-'] {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);

          &:focus {
            border-color: var(--border-focus);
            outline: none;
          }
        }

        /* Select elements */
        .ag-select {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);
        }

        .ag-picker-field-wrapper {
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-primary);
        }

        /* Icons */
        .ag-icon {
          color: var(--text-secondary);
        }

        /* Header checkbox */
        .ag-header-select-all {
          .ag-checkbox-input-wrapper {
            background-color: var(--bg-secondary);
          }
        }

        /* Tooltip */
        .ag-tooltip {
          background-color: var(--bg-elevated);
          color: var(--text-primary);
          border: 1px solid var(--border-primary);
          box-shadow: var(--shadow-md);
        }

        /* Column header sort icons */
        .ag-sort-indicator-icon {
          color: var(--text-secondary);
        }

        /* Filter icons */
        .ag-header-cell-filter-button {
          color: var(--text-secondary);

          &:hover {
            color: var(--text-primary);
          }
        }
      }
    `,
  ],
})
export class ResultsGridComponent implements OnChanges {
  @Input() resultSet: ResultSet | null = null;
  @Input() tableName: string = 'result';
  @Output() cellSelected = new EventEmitter<{ row: number; column: string; value: unknown }>();
  @Output() exportRequested = new EventEmitter<'csv' | 'json' | 'sql'>();

  private readonly notification = inject(NotificationService);
  private readonly ipc = inject(IpcService);
  private gridApi: GridApi | null = null;

  rowData: Record<string, unknown>[] = [];
  columnDefs: ColDef[] = [];
  rowCount = signal(0);
  selectedCount = signal(0);
  filterText = signal('');
  showStats = signal(false);
  selectedCell = signal<{ column: string; type: string; value: unknown } | null>(null);
  contextMenuPosition = signal<{ x: number; y: number } | null>(null);
  private contextMenuCell: { row: Record<string, unknown>; column: string } | null = null;

  readonly columnStats = computed(() => {
    if (!this.resultSet) return [];
    return this.calculateColumnStats();
  });

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 80,
    suppressSizeToFit: false,
  };

  // New object-based row selection (replaces deprecated string values)
  rowSelectionOptions = {
    mode: 'multiRow' as const,
    copySelectedRows: false,
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resultSet'] && this.resultSet) {
      this.updateGrid();
    }
  }

  private updateGrid(): void {
    if (!this.resultSet) {
      this.rowData = [];
      this.columnDefs = [];
      this.rowCount.set(0);
      return;
    }

    // Build column definitions
    this.columnDefs = [
      // Row number column
      {
        headerName: '#',
        valueGetter: params => (params.node?.rowIndex != null ? params.node.rowIndex + 1 : ''),
        width: 60,
        maxWidth: 80,
        pinned: 'left',
        sortable: false,
        filter: false,
        resizable: false,
        cellClass: 'row-number-cell',
        suppressSizeToFit: true,
      },
      // Data columns
      ...this.resultSet.columns.map(col => this.createColumnDef(col)),
    ];

    // Set row data
    this.rowData = this.resultSet.rows;
    this.rowCount.set(this.resultSet.rows.length);

    // Auto-size columns after data loads
    setTimeout(() => this.autoSizeAllColumns(), 100);
  }

  private createColumnDef(column: ColumnMetadata): ColDef {
    const colDef: ColDef = {
      field: column.name,
      headerName: column.name,
      headerTooltip: `${column.name} (${column.type})`,
      valueFormatter: (params: ValueFormatterParams) => this.formatValue(params.value, column),
      cellClass: (params: CellClassParams) => this.getCellClass(params.value, column),
    };

    // Set column width based on data type
    if (this.isNumericType(column.type)) {
      colDef.width = 120;
      colDef.type = 'numericColumn';
    } else if (this.isBooleanType(column.type)) {
      colDef.width = 80;
    } else if (this.isDateType(column.type)) {
      colDef.width = 180;
    } else if (column.maxLength && column.maxLength < 50) {
      colDef.width = Math.max(100, column.maxLength * 8);
    } else {
      colDef.minWidth = 150;
    }

    return colDef;
  }

  private formatValue(value: unknown, column: ColumnMetadata): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    if (typeof value === 'object') {
      return JSON.stringify(value);
    }

    // Format numbers with appropriate precision
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return value.toLocaleString();
      }
      // Handle decimal precision based on column metadata
      const precision = column.scale ?? 2;
      return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: precision,
      });
    }

    return String(value);
  }

  private getCellClass(value: unknown, column: ColumnMetadata): string | string[] {
    const classes: string[] = [];

    if (value === null || value === undefined) {
      classes.push('cell-null');
    } else if (this.isNumericType(column.type)) {
      classes.push('cell-number');
    } else if (this.isBooleanType(column.type)) {
      classes.push('cell-boolean');
    } else if (this.isDateType(column.type)) {
      classes.push('cell-date');
    }

    return classes;
  }

  private isNumericType(type: string): boolean {
    const numericTypes = [
      'int',
      'bigint',
      'smallint',
      'tinyint',
      'decimal',
      'numeric',
      'float',
      'real',
      'money',
      'smallmoney',
    ];
    return numericTypes.some(t => type.toLowerCase().includes(t));
  }

  private isBooleanType(type: string): boolean {
    return type.toLowerCase() === 'bit' || type.toLowerCase() === 'boolean';
  }

  private isDateType(type: string): boolean {
    const dateTypes = ['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'];
    return dateTypes.some(t => type.toLowerCase().includes(t));
  }

  onGridReady(params: GridReadyEvent): void {
    this.gridApi = params.api;
  }

  onCellClicked(event: CellClickedEvent): void {
    const field = event.colDef.field ?? '';
    const column = this.resultSet?.columns.find(c => c.name === field);

    this.cellSelected.emit({
      row: event.rowIndex ?? 0,
      column: field,
      value: event.value,
    });

    // Update selected cell for preview panel (only for long values)
    if (field && column) {
      const valueStr = this.formatPreviewValue(event.value);
      if (valueStr.length > 50 || valueStr.includes('\n')) {
        this.selectedCell.set({
          column: field,
          type: column.type,
          value: event.value,
        });
      }
    }
  }

  onSelectionChanged(): void {
    if (!this.gridApi) return;

    const selectedRows = this.gridApi.getSelectedRows();
    this.selectedCount.set(selectedRows.length);
  }

  autoSizeAllColumns(): void {
    if (!this.gridApi) return;
    this.gridApi.autoSizeAllColumns();
  }

  copySelectedToClipboard(includeHeaders = false): void {
    if (!this.gridApi) return;

    const selectedRows = this.gridApi.getSelectedRows();

    if (selectedRows.length === 0) {
      // If no rows selected, copy focused cell
      const focusedCell = this.gridApi.getFocusedCell();
      if (focusedCell) {
        const rowNode = this.gridApi.getDisplayedRowAtIndex(focusedCell.rowIndex);
        if (rowNode && rowNode.data) {
          const colId = focusedCell.column.getColId();
          const value = rowNode.data[colId];
          navigator.clipboard.writeText(this.formatValueForClipboard(value));
          this.notification.info('Cell copied to clipboard');
        }
      }
      return;
    }

    // Get visible columns (excluding row number column)
    const columns = this.gridApi.getAllDisplayedColumns().filter(col => col.getColId() !== '0'); // Filter out row number column

    const lines: string[] = [];

    // Add headers if requested
    if (includeHeaders) {
      const headers = columns.map(col => col.getColDef().headerName || col.getColId());
      lines.push(headers.join('\t'));
    }

    // Add data rows
    for (const row of selectedRows) {
      const values = columns.map(col => {
        const colId = col.getColId();
        const value = row[colId];
        return this.formatValueForClipboard(value);
      });
      lines.push(values.join('\t'));
    }

    const text = lines.join('\n');
    navigator.clipboard.writeText(text);

    this.notification.info(
      `Copied ${selectedRows.length} row${selectedRows.length > 1 ? 's' : ''} to clipboard`
    );
  }

  private formatValueForClipboard(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  exportCsv(): void {
    if (!this.gridApi) return;
    this.gridApi.exportDataAsCsv({
      skipColumnGroupHeaders: true,
      skipColumnHeaders: false,
      allColumns: false,
      onlySelected: false,
      fileName: `query-results-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    this.notification.info('Results exported to CSV');
  }

  async exportJson(): Promise<void> {
    if (!this.resultSet || !this.ipc.isAvailable) return;

    const json = JSON.stringify(this.resultSet.rows, null, 2);
    const defaultPath = `query-results-${new Date().toISOString().slice(0, 10)}.json`;

    try {
      const result = await firstValueFrom(
        this.ipc.showSaveDialog({
          title: 'Export as JSON',
          defaultPath,
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
        })
      );

      if (!result.canceled && result.filePath) {
        await firstValueFrom(this.ipc.writeWorkspaceFile(result.filePath, json));
        this.notification.success('Results exported to JSON');
      }
    } catch (error) {
      this.notification.error('Failed to export JSON');
      console.error('Export JSON failed:', error);
    }
  }

  async exportSqlInsert(): Promise<void> {
    if (!this.resultSet) return;

    const columns = this.resultSet.columns.map(c => `[${c.name}]`).join(', ');
    const inserts: string[] = [];

    for (const row of this.resultSet.rows) {
      const values = this.resultSet.columns.map(col => {
        const value = row[col.name];
        return this.formatSqlValue(value, col);
      });
      inserts.push(`INSERT INTO [${this.tableName}] (${columns}) VALUES (${values.join(', ')});`);
    }

    const sql = inserts.join('\n');

    if (this.ipc.isAvailable) {
      const defaultPath = `insert-${this.tableName}-${new Date().toISOString().slice(0, 10)}.sql`;

      try {
        const result = await firstValueFrom(
          this.ipc.showSaveDialog({
            title: 'Export as SQL INSERT',
            defaultPath,
            filters: [{ name: 'SQL Files', extensions: ['sql'] }],
          })
        );

        if (!result.canceled && result.filePath) {
          await firstValueFrom(this.ipc.writeWorkspaceFile(result.filePath, sql));
          this.notification.success('Results exported as SQL INSERT statements');
        }
      } catch (error) {
        this.notification.error('Failed to export SQL');
        console.error('Export SQL failed:', error);
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(sql);
      this.notification.info('SQL INSERT statements copied to clipboard');
    }
  }

  private formatSqlValue(value: unknown, _column: ColumnMetadata): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    if (typeof value === 'string') {
      return `N'${value.replace(/'/g, "''")}'`;
    }

    if (typeof value === 'object') {
      return `N'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }

    return `N'${String(value).replace(/'/g, "''")}'`;
  }

  onFilterChange(text: string): void {
    this.filterText.set(text);
  }

  clearFilter(): void {
    this.filterText.set('');
  }

  toggleStats(): void {
    this.showStats.update(v => !v);
  }

  private calculateColumnStats(): ColumnStats[] {
    if (!this.resultSet) return [];

    return this.resultSet.columns.map(col => {
      const values = this.resultSet!.rows.map(r => r[col.name]);
      const nonNullValues = values.filter(v => v !== null && v !== undefined);
      const distinctValues = new Set(nonNullValues.map(v => JSON.stringify(v)));

      const stats: ColumnStats = {
        column: col.name,
        type: col.type,
        nullCount: values.length - nonNullValues.length,
        distinctCount: distinctValues.size,
      };

      // Calculate min/max for comparable types
      if (nonNullValues.length > 0) {
        if (this.isNumericType(col.type)) {
          const numericValues = nonNullValues.filter(v => typeof v === 'number') as number[];
          if (numericValues.length > 0) {
            stats.minValue = Math.min(...numericValues);
            stats.maxValue = Math.max(...numericValues);
            stats.avgValue = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
          }
        } else if (this.isDateType(col.type)) {
          const dateValues = nonNullValues
            .map(v => (v instanceof Date ? v : new Date(String(v))))
            .filter(d => !isNaN(d.getTime()));
          if (dateValues.length > 0) {
            stats.minValue = new Date(Math.min(...dateValues.map(d => d.getTime())))
              .toISOString()
              .slice(0, 10);
            stats.maxValue = new Date(Math.max(...dateValues.map(d => d.getTime())))
              .toISOString()
              .slice(0, 10);
          }
        } else if (typeof nonNullValues[0] === 'string') {
          const stringValues = nonNullValues.filter(v => typeof v === 'string') as string[];
          if (stringValues.length > 0) {
            const sorted = [...stringValues].sort();
            stats.minValue = sorted[0].slice(0, 20) + (sorted[0].length > 20 ? '...' : '');
            stats.maxValue =
              sorted[sorted.length - 1].slice(0, 20) +
              (sorted[sorted.length - 1].length > 20 ? '...' : '');
          }
        }
      }

      return stats;
    });
  }

  onCellContextMenu(event: CellContextMenuEvent): void {
    event.event?.preventDefault();

    const mouseEvent = event.event as MouseEvent;
    this.contextMenuPosition.set({ x: mouseEvent.clientX, y: mouseEvent.clientY });
    this.contextMenuCell = {
      row: event.data,
      column: event.colDef?.field || '',
    };
  }

  closeContextMenu(): void {
    this.contextMenuPosition.set(null);
    this.contextMenuCell = null;
  }

  copyCellValue(): void {
    if (this.contextMenuCell) {
      const value = this.contextMenuCell.row[this.contextMenuCell.column];
      navigator.clipboard.writeText(this.formatValueForClipboard(value));
      this.notification.info('Cell value copied');
    }
    this.closeContextMenu();
  }

  copyRowAsJson(): void {
    if (this.contextMenuCell) {
      const json = JSON.stringify(this.contextMenuCell.row, null, 2);
      navigator.clipboard.writeText(json);
      this.notification.info('Row copied as JSON');
    }
    this.closeContextMenu();
  }

  copyRowAsSql(): void {
    if (this.contextMenuCell && this.resultSet) {
      const columns = this.resultSet.columns.map(c => `[${c.name}]`).join(', ');
      const values = this.resultSet.columns.map(col => {
        const value = this.contextMenuCell!.row[col.name];
        return this.formatSqlValue(value, col);
      });
      const sql = `INSERT INTO [${this.tableName}] (${columns}) VALUES (${values.join(', ')});`;
      navigator.clipboard.writeText(sql);
      this.notification.info('Row copied as INSERT statement');
    }
    this.closeContextMenu();
  }

  filterByValue(): void {
    if (this.contextMenuCell) {
      const value = this.contextMenuCell.row[this.contextMenuCell.column];
      const filterValue = value === null ? 'NULL' : String(value);
      this.filterText.set(filterValue);
    }
    this.closeContextMenu();
  }

  excludeValue(): void {
    if (this.contextMenuCell) {
      // Note: Quick filter doesn't support exclusion
      this.notification.info('Use column filter for exclusion');
    }
    this.closeContextMenu();
  }

  formatPreviewValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  copyPreviewValue(): void {
    const cell = this.selectedCell();
    if (cell) {
      navigator.clipboard.writeText(this.formatPreviewValue(cell.value));
      this.notification.info('Value copied to clipboard');
    }
  }
}
