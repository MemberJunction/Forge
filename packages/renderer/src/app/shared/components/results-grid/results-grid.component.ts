import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import {
  ColDef,
  GridApi,
  GridReadyEvent,
  CellClickedEvent,
  ValueFormatterParams,
  CellClassParams,
  ModuleRegistry,
  AllCommunityModule,
} from 'ag-grid-community';
import type { ResultSet, ColumnMetadata } from '@mj-forge/shared';
import { NotificationService } from '../../../core/services/notification.service';

// Register all community modules
ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-results-grid',
  standalone: true,
  imports: [CommonModule, AgGridAngular],
  template: `
    <div class="results-grid-container">
      <div class="grid-toolbar">
        <div class="grid-info">
          <span class="row-count">{{ rowCount() }} rows</span>
          @if (selectedCount() > 0) {
            <span class="selection-info">{{ selectedCount() }} cells selected</span>
          }
        </div>
        <div class="grid-actions">
          <button class="grid-btn" (click)="autoSizeAllColumns()" title="Auto-size columns">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M4 4h16v2H4V4zm0 6h16v2H4v-2zm0 6h16v2H4v-2z" />
            </svg>
          </button>
          <button
            class="grid-btn"
            (click)="copySelectedToClipboard()"
            title="Copy selected (Ctrl+C)"
          >
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="currentColor"
                d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
              />
            </svg>
          </button>
          <button class="grid-btn" (click)="exportCsv()" title="Export to CSV">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </button>
        </div>
      </div>
      <ag-grid-angular
        class="ag-theme-custom"
        [rowData]="rowData"
        [columnDefs]="columnDefs"
        [defaultColDef]="defaultColDef"
        [rowSelection]="rowSelectionOptions"
        [suppressClipboardPaste]="true"
        [animateRows]="false"
        [suppressRowHoverHighlight]="false"
        [rowBuffer]="20"
        (gridReady)="onGridReady($event)"
        (cellClicked)="onCellClicked($event)"
        (selectionChanged)="onSelectionChanged()"
      />
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
      }

      .grid-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        background-color: var(--bg-tertiary, #1e1e1e);
        border-bottom: 1px solid var(--border-primary, #333);
        min-height: 28px;
      }

      .grid-info {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        color: var(--text-secondary, #888);
      }

      .row-count {
        color: var(--text-primary, #ccc);
      }

      .selection-info {
        color: var(--status-info, #4fc3f7);
      }

      .grid-actions {
        display: flex;
        gap: 4px;
      }

      .grid-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--text-secondary, #888);
        cursor: pointer;
        transition: all 0.15s ease;

        &:hover {
          background-color: var(--bg-hover, #2a2a2a);
          color: var(--text-primary, #ccc);
        }

        &:active {
          background-color: var(--bg-active, #333);
        }
      }

      ag-grid-angular {
        flex: 1;
        width: 100%;
        height: 100%;
      }

      /* Custom ag-Grid theme */
      :host ::ng-deep .ag-theme-custom {
        --ag-background-color: var(--bg-primary, #1e1e1e);
        --ag-header-background-color: var(--bg-secondary, #252526);
        --ag-odd-row-background-color: var(--bg-primary, #1e1e1e);
        --ag-row-hover-color: var(--bg-hover, #2a2d2e);
        --ag-selected-row-background-color: rgba(33, 150, 243, 0.2);
        --ag-range-selection-background-color: rgba(33, 150, 243, 0.3);
        --ag-range-selection-border-color: #2196f3;
        --ag-header-foreground-color: var(--text-secondary, #888);
        --ag-foreground-color: var(--text-primary, #ccc);
        --ag-border-color: var(--border-primary, #333);
        --ag-secondary-foreground-color: var(--text-muted, #666);
        --ag-font-family: 'JetBrains Mono', 'Consolas', monospace;
        --ag-font-size: 12px;
        --ag-row-height: 24px;
        --ag-header-height: 32px;
        --ag-cell-horizontal-padding: 8px;

        .ag-root-wrapper {
          border: none;
        }

        .ag-header {
          border-bottom: 1px solid var(--border-primary, #333);
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
          border-right: 1px solid var(--border-primary, #333);
          line-height: 24px;
        }

        .ag-row {
          border-bottom: 1px solid var(--border-primary, #2a2a2a);
        }

        .ag-cell.cell-null {
          color: var(--text-muted, #666);
          font-style: italic;
        }

        .ag-cell.cell-number {
          text-align: right;
        }

        .ag-cell.cell-boolean {
          color: var(--status-info, #4fc3f7);
        }

        .ag-cell.cell-date {
          color: var(--status-warning, #ffb74d);
        }

        /* Row number column */
        .ag-cell.row-number-cell {
          background-color: var(--bg-secondary, #252526);
          color: var(--text-muted, #666);
          text-align: right;
          font-size: 10px;
          border-right: 1px solid var(--border-primary, #333);
        }

        /* Context menu styling */
        .ag-menu {
          background-color: var(--bg-secondary, #252526);
          border: 1px solid var(--border-primary, #333);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .ag-menu-option {
          padding: 8px 12px;
          cursor: pointer;

          &:hover {
            background-color: var(--bg-hover, #2a2d2e);
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
          background: var(--bg-primary, #1e1e1e);
        }

        ::-webkit-scrollbar-thumb {
          background: var(--border-primary, #444);
          border-radius: 5px;

          &:hover {
            background: var(--text-muted, #555);
          }
        }

        /* Filter styling */
        .ag-filter {
          background-color: var(--bg-secondary, #252526);
          border: 1px solid var(--border-primary, #333);
        }

        .ag-filter-body-wrapper {
          padding: 8px;
        }

        .ag-text-field-input {
          background-color: var(--bg-primary, #1e1e1e);
          border: 1px solid var(--border-primary, #333);
          color: var(--text-primary, #ccc);
          padding: 4px 8px;
          border-radius: 4px;

          &:focus {
            border-color: var(--status-info, #4fc3f7);
            outline: none;
          }
        }
      }
    `,
  ],
})
export class ResultsGridComponent implements OnChanges {
  @Input() resultSet: ResultSet | null = null;
  @Output() cellSelected = new EventEmitter<{ row: number; column: string; value: unknown }>();
  @Output() exportRequested = new EventEmitter<'csv' | 'json' | 'sql'>();

  private readonly notification = inject(NotificationService);
  private gridApi: GridApi | null = null;

  rowData: Record<string, unknown>[] = [];
  columnDefs: ColDef[] = [];
  rowCount = signal(0);
  selectedCount = signal(0);

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
    this.cellSelected.emit({
      row: event.rowIndex ?? 0,
      column: event.colDef.field ?? '',
      value: event.value,
    });
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
}
