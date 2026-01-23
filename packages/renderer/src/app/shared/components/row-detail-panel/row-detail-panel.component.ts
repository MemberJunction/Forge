import {
  Component,
  Input,
  Output,
  EventEmitter,
  HostListener,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import type { ColumnMetadata } from '@mj-forge/shared';

export interface RowDetailData {
  rowIndex: number;
  row: Record<string, unknown>;
  columns: ColumnMetadata[];
}

@Component({
  selector: 'app-row-detail-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule, MatTabsModule],
  template: `
    @if (isOpen()) {
      <div class="detail-overlay" (click)="close()"></div>
      <div class="detail-panel" (click)="$event.stopPropagation()">
        <header class="panel-header">
          <div class="header-info">
            <mat-icon>table_rows</mat-icon>
            <h3>Row {{ (data()?.rowIndex ?? 0) + 1 }} Details</h3>
          </div>
          <div class="header-actions">
            <button mat-icon-button (click)="copyAllToClipboard()" matTooltip="Copy all values">
              <mat-icon>content_copy</mat-icon>
            </button>
            <button mat-icon-button (click)="close()" matTooltip="Close (Esc)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        </header>

        <div class="panel-content">
          <mat-tab-group animationDuration="150ms">
            <mat-tab label="Values">
              <div class="tab-content">
                <div class="column-list">
                  @for (col of columnDetails(); track col.name) {
                    <div
                      class="column-item"
                      [class.selected]="selectedColumn() === col.name"
                      (click)="selectColumn(col.name)"
                    >
                      <div class="column-header">
                        <span class="column-name">{{ col.name }}</span>
                        <span class="column-type">{{ col.type }}</span>
                      </div>
                      <div class="column-value" [class.null-value]="col.isNull">
                        @if (col.isNull) {
                          <span class="null-indicator">NULL</span>
                        } @else if (col.isTruncated) {
                          <span class="value-text">{{ col.displayValue }}</span>
                          <span class="truncated-indicator">...</span>
                        } @else {
                          <span class="value-text">{{ col.displayValue }}</span>
                        }
                      </div>
                      <div class="column-actions">
                        <button
                          mat-icon-button
                          class="small-btn"
                          (click)="copyValue(col.rawValue, $event)"
                          matTooltip="Copy value"
                        >
                          <mat-icon>content_copy</mat-icon>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </mat-tab>

            <mat-tab label="Full Value">
              <div class="tab-content full-value-tab">
                @if (selectedColumnData()) {
                  <div class="full-value-header">
                    <span class="column-name">{{ selectedColumnData()?.name }}</span>
                    <span class="column-type">{{ selectedColumnData()?.type }}</span>
                    <button
                      mat-stroked-button
                      class="copy-btn"
                      (click)="copyValue(selectedColumnData()?.rawValue)"
                    >
                      <mat-icon>content_copy</mat-icon>
                      Copy
                    </button>
                  </div>
                  <div class="full-value-content">
                    @if (selectedColumnData()?.isNull) {
                      <span class="null-indicator large">NULL</span>
                    } @else {
                      <pre class="value-pre">{{ selectedColumnData()?.fullValue }}</pre>
                    }
                  </div>
                } @else {
                  <div class="no-selection">
                    <mat-icon>touch_app</mat-icon>
                    <p>Select a column from the Values tab to view its full content</p>
                  </div>
                }
              </div>
            </mat-tab>

            <mat-tab label="Schema">
              <div class="tab-content schema-tab">
                <table class="schema-table">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Data Type</th>
                      <th>Nullable</th>
                      <th>Max Length</th>
                      <th>Precision</th>
                      <th>Scale</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (col of data()?.columns ?? []; track col.name) {
                      <tr>
                        <td class="col-name">{{ col.name }}</td>
                        <td class="col-type">{{ col.type }}</td>
                        <td class="col-nullable">{{ col.nullable ? 'Yes' : 'No' }}</td>
                        <td class="col-length">{{ col.maxLength ?? '-' }}</td>
                        <td class="col-precision">{{ col.precision ?? '-' }}</td>
                        <td class="col-scale">{{ col.scale ?? '-' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </mat-tab>
          </mat-tab-group>
        </div>

        <footer class="panel-footer">
          <span class="column-count">{{ data()?.columns?.length ?? 0 }} columns</span>
          <button mat-stroked-button (click)="previousRow()" [disabled]="!canGoPrevious()">
            <mat-icon>chevron_left</mat-icon>
            Previous
          </button>
          <button mat-stroked-button (click)="nextRow()" [disabled]="!canGoNext()">
            Next
            <mat-icon>chevron_right</mat-icon>
          </button>
        </footer>
      </div>
    }
  `,
  styles: [
    `
      .detail-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.4);
        z-index: 1000;
        animation: fadeIn 0.15s ease;
      }

      .detail-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 480px;
        max-width: 95vw;
        background-color: var(--bg-secondary);
        border-left: 1px solid var(--border-primary);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.2s ease;
        box-shadow: var(--shadow-lg);
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);

        .header-info {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);

          mat-icon {
            color: var(--status-info);
          }

          h3 {
            font-size: var(--font-size-md);
            font-weight: 600;
            margin: 0;
            color: var(--text-primary);
          }
        }

        .header-actions {
          display: flex;
          gap: var(--spacing-xs);
        }
      }

      .panel-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;

        ::ng-deep .mat-mdc-tab-group {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        ::ng-deep .mat-mdc-tab-body-wrapper {
          flex: 1;
          overflow: hidden;
        }

        ::ng-deep .mat-mdc-tab-body-content {
          height: 100%;
          overflow: hidden;
        }
      }

      .tab-content {
        height: 100%;
        overflow-y: auto;
        padding: var(--spacing-sm);
      }

      .column-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .column-item {
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        gap: var(--spacing-xs);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-primary);
        border-radius: var(--radius-md);
        border: 1px solid var(--border-primary);
        cursor: pointer;
        transition: all var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
          border-color: var(--border-secondary);
        }

        &.selected {
          border-color: var(--status-info);
          background-color: rgba(55, 148, 255, 0.1);
        }

        .column-header {
          display: flex;
          align-items: baseline;
          gap: var(--spacing-sm);
        }

        .column-name {
          font-weight: 600;
          color: var(--text-primary);
          font-size: var(--font-size-sm);
        }

        .column-type {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
          font-family: var(--font-mono);
        }

        .column-value {
          grid-column: 1;
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;

          &.null-value {
            color: var(--text-muted);
            font-style: italic;
          }

          .truncated-indicator {
            color: var(--text-muted);
          }
        }

        .column-actions {
          grid-column: 2;
          grid-row: 1 / 3;
          display: flex;
          align-items: center;
          opacity: 0;
          transition: opacity var(--transition-fast);

          .small-btn {
            width: 28px;
            height: 28px;

            mat-icon {
              font-size: 16px;
              width: 16px;
              height: 16px;
            }
          }
        }

        &:hover .column-actions {
          opacity: 1;
        }
      }

      .null-indicator {
        color: var(--text-muted);
        font-style: italic;

        &.large {
          font-size: var(--font-size-lg);
          padding: var(--spacing-lg);
          text-align: center;
          display: block;
        }
      }

      .full-value-tab {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);

        .full-value-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          padding: var(--spacing-sm) var(--spacing-md);
          background-color: var(--bg-tertiary);
          border-radius: var(--radius-md);

          .column-name {
            font-weight: 600;
            color: var(--text-primary);
          }

          .column-type {
            font-size: var(--font-size-sm);
            color: var(--text-muted);
            font-family: var(--font-mono);
          }

          .copy-btn {
            margin-left: auto;
            display: flex;
            align-items: center;
            gap: var(--spacing-xs);

            mat-icon {
              font-size: 16px;
              width: 16px;
              height: 16px;
            }
          }
        }

        .full-value-content {
          flex: 1;
          overflow: auto;
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          border-radius: var(--radius-md);
          padding: var(--spacing-md);
        }

        .value-pre {
          font-family: var(--font-mono);
          font-size: var(--font-size-sm);
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-all;
          margin: 0;
        }

        .no-selection {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: var(--text-muted);
          gap: var(--spacing-sm);

          mat-icon {
            font-size: 48px;
            width: 48px;
            height: 48px;
            opacity: 0.5;
          }

          p {
            margin: 0;
            text-align: center;
          }
        }
      }

      .schema-tab {
        .schema-table {
          width: 100%;
          border-collapse: collapse;
          font-size: var(--font-size-sm);

          th,
          td {
            padding: var(--spacing-sm) var(--spacing-md);
            text-align: left;
            border-bottom: 1px solid var(--border-primary);
          }

          th {
            font-weight: 600;
            color: var(--text-secondary);
            background-color: var(--bg-tertiary);
            position: sticky;
            top: 0;
          }

          td {
            color: var(--text-primary);
          }

          .col-name {
            font-weight: 500;
          }

          .col-type {
            font-family: var(--font-mono);
            color: var(--status-info);
          }

          .col-nullable,
          .col-length,
          .col-precision,
          .col-scale {
            color: var(--text-secondary);
          }

          tr:hover td {
            background-color: var(--bg-hover);
          }
        }
      }

      .panel-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
        gap: var(--spacing-sm);

        .column-count {
          font-size: var(--font-size-sm);
          color: var(--text-muted);
        }

        button {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }
      }
    `,
  ],
})
export class RowDetailPanelComponent {
  private readonly _data = signal<RowDetailData | null>(null);
  readonly data = this._data.asReadonly();

  @Input()
  set inputData(value: RowDetailData | null) {
    this._data.set(value);
    if (value) {
      this._isOpen.set(true);
      this._selectedColumn.set(null);
    }
  }

  @Input() totalRows = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() navigateRow = new EventEmitter<'next' | 'previous'>();

  private readonly _isOpen = signal(false);
  private readonly _selectedColumn = signal<string | null>(null);

  readonly isOpen = this._isOpen.asReadonly();
  readonly selectedColumn = this._selectedColumn.asReadonly();

  readonly columnDetails = computed(() => {
    const data = this._data();
    if (!data) return [];

    return data.columns.map(col => {
      const rawValue = data.row[col.name];
      const isNull = rawValue === null || rawValue === undefined;
      const fullValue = isNull ? '' : this.formatFullValue(rawValue);
      const displayValue = this.truncateValue(fullValue, 100);

      return {
        name: col.name,
        type: col.type,
        rawValue,
        fullValue,
        displayValue,
        isNull,
        isTruncated: displayValue.length < fullValue.length,
      };
    });
  });

  readonly selectedColumnData = computed(() => {
    const name = this._selectedColumn();
    if (!name) return null;
    return this.columnDetails().find(c => c.name === name) ?? null;
  });

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this._isOpen()) {
      this.close();
    }
  }

  open(): void {
    this._isOpen.set(true);
    this._selectedColumn.set(null);
  }

  close(): void {
    this._isOpen.set(false);
    this.closed.emit();
  }

  selectColumn(name: string): void {
    this._selectedColumn.set(name);
  }

  canGoPrevious(): boolean {
    const data = this._data();
    return !!data && data.rowIndex > 0;
  }

  canGoNext(): boolean {
    const data = this._data();
    return !!data && data.rowIndex < this.totalRows - 1;
  }

  previousRow(): void {
    if (this.canGoPrevious()) {
      this.navigateRow.emit('previous');
    }
  }

  nextRow(): void {
    if (this.canGoNext()) {
      this.navigateRow.emit('next');
    }
  }

  copyValue(value: unknown, event?: Event): void {
    event?.stopPropagation();
    const text = this.formatFullValue(value);
    navigator.clipboard.writeText(text);
  }

  copyAllToClipboard(): void {
    const data = this._data();
    if (!data) return;

    const lines = data.columns.map(col => {
      const value = data.row[col.name];
      return `${col.name}: ${this.formatFullValue(value)}`;
    });

    navigator.clipboard.writeText(lines.join('\n'));
  }

  private formatFullValue(value: unknown): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  }

  private truncateValue(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return value.substring(0, maxLength);
  }
}
