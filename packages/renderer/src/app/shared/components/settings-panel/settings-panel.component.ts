import { Component, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingsService } from '../../../core/services/settings.service';
import type { ThemePreference } from '@mj-forge/shared';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
  ],
  template: `
    @if (settingsService.isOpen()) {
      <div class="settings-overlay" (click)="close()"></div>
      <div class="settings-panel" (click)="$event.stopPropagation()">
        <header class="settings-header">
          <h2>Settings</h2>
          <button mat-icon-button (click)="close()" matTooltip="Close (Esc)">
            <mat-icon>close</mat-icon>
          </button>
        </header>

        <div class="settings-content">
          <!-- Appearance Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>palette</mat-icon>
              Appearance
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Theme</label>
                <span class="setting-description">Choose your preferred color theme</span>
              </div>
              <mat-form-field appearance="outline" class="theme-select">
                <mat-select
                  [value]="settings().theme"
                  (selectionChange)="updateTheme($event.value)"
                >
                  <mat-option value="system">
                    <mat-icon>brightness_auto</mat-icon>
                    System
                  </mat-option>
                  <mat-option value="light">
                    <mat-icon>light_mode</mat-icon>
                    Light
                  </mat-option>
                  <mat-option value="dark">
                    <mat-icon>dark_mode</mat-icon>
                    Dark
                  </mat-option>
                </mat-select>
              </mat-form-field>
            </div>
          </section>

          <!-- Editor Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>code</mat-icon>
              Editor
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Font Size</label>
                <span class="setting-description">Editor font size in pixels</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().editor.fontSize"
                  (change)="updateEditorSetting('fontSize', +$any($event.target).value)"
                  min="10"
                  max="24"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Tab Size</label>
                <span class="setting-description">Number of spaces per tab</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().editor.tabSize"
                  (change)="updateEditorSetting('tabSize', +$any($event.target).value)"
                  min="2"
                  max="8"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Word Wrap</label>
                <span class="setting-description">Wrap long lines in the editor</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.wordWrap"
                (change)="updateEditorSetting('wordWrap', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Minimap</label>
                <span class="setting-description">Show code minimap on the right</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.minimap"
                (change)="updateEditorSetting('minimap', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Line Numbers</label>
                <span class="setting-description">Show line numbers in the editor</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.lineNumbers"
                (change)="updateEditorSetting('lineNumbers', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Auto Complete</label>
                <span class="setting-description">Show suggestions while typing</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.autoComplete"
                (change)="updateEditorSetting('autoComplete', $event.checked)"
              />
            </div>
          </section>

          <!-- Query Execution Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>play_arrow</mat-icon>
              Query Execution
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Default Timeout</label>
                <span class="setting-description">Query timeout in seconds</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().query.defaultTimeout / 1000"
                  (change)="updateQuerySetting('defaultTimeout', +$any($event.target).value * 1000)"
                  min="5"
                  max="300"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Max Rows to Display</label>
                <span class="setting-description">Limit rows shown in results grid</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().query.maxRowsToDisplay"
                  (change)="updateQuerySetting('maxRowsToDisplay', +$any($event.target).value)"
                  min="100"
                  max="100000"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Show Execution Time</label>
                <span class="setting-description">Display query execution duration</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().query.showExecutionTime"
                (change)="updateQuerySetting('showExecutionTime', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Confirm Before Execute</label>
                <span class="setting-description">Show confirmation before running queries</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().query.confirmBeforeExecute"
                (change)="updateQuerySetting('confirmBeforeExecute', $event.checked)"
              />
            </div>
          </section>

          <!-- Results Grid Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>grid_on</mat-icon>
              Results Grid
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Row Height</label>
                <span class="setting-description">Height of each row in pixels</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().grid.rowHeight"
                  (change)="updateGridSetting('rowHeight', +$any($event.target).value)"
                  min="20"
                  max="48"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Show Row Numbers</label>
                <span class="setting-description">Display row numbers column</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().grid.showRowNumbers"
                (change)="updateGridSetting('showRowNumbers', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Alternating Row Colors</label>
                <span class="setting-description">Zebra striping for rows</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().grid.alternatingRowColors"
                (change)="updateGridSetting('alternatingRowColors', $event.checked)"
              />
            </div>
          </section>
        </div>

        <footer class="settings-footer">
          <button mat-stroked-button (click)="resetToDefaults()">
            <mat-icon>restore</mat-icon>
            Reset to Defaults
          </button>
          <span class="keyboard-hint">Press Esc to close</span>
        </footer>
      </div>
    }
  `,
  styles: [
    `
      .settings-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        animation: fadeIn 0.2s ease;
      }

      .settings-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 420px;
        max-width: 90vw;
        background-color: var(--bg-secondary);
        border-left: 1px solid var(--border-primary);
        z-index: 1001;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.25s ease;
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

      .settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);

        h2 {
          font-size: var(--font-size-xl);
          font-weight: 600;
          margin: 0;
          color: var(--text-primary);
        }
      }

      .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .settings-section {
        margin-bottom: var(--spacing-lg);

        h3 {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          font-size: var(--font-size-md);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 var(--spacing-md);
          padding-bottom: var(--spacing-sm);
          border-bottom: 1px solid var(--border-primary);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            color: var(--status-info);
          }
        }
      }

      .setting-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-xs);
        border-radius: var(--radius-md);
        background-color: var(--bg-primary);
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }
      }

      .setting-info {
        display: flex;
        flex-direction: column;
        gap: 2px;

        label {
          font-size: var(--font-size-md);
          font-weight: 500;
          color: var(--text-primary);
        }

        .setting-description {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }
      }

      .theme-select {
        width: 140px;

        ::ng-deep .mat-mdc-select-value {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
        }

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          margin-right: var(--spacing-xs);
        }
      }

      .number-input {
        width: 100px;
      }

      ::ng-deep .mat-mdc-form-field-subscript-wrapper {
        display: none;
      }

      ::ng-deep .mat-mdc-text-field-wrapper {
        background-color: var(--bg-tertiary);
      }

      ::ng-deep .mat-mdc-form-field.mat-focused .mat-mdc-text-field-wrapper {
        background-color: var(--bg-primary);
      }

      ::ng-deep .mat-mdc-slide-toggle {
        --mdc-switch-selected-track-color: var(--status-info);
        --mdc-switch-selected-handle-color: white;
        --mdc-switch-selected-hover-track-color: var(--status-info);
        --mdc-switch-selected-focus-track-color: var(--status-info);
        --mdc-switch-selected-pressed-track-color: var(--status-info);
      }

      .settings-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);

        button {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          color: var(--text-secondary);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }

          &:hover {
            color: var(--text-primary);
          }
        }

        .keyboard-hint {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }
      }
    `,
  ],
})
export class SettingsPanelComponent {
  readonly settingsService = inject(SettingsService);
  readonly settings = this.settingsService.settings;

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.settingsService.isOpen()) {
      this.close();
    }
  }

  close(): void {
    this.settingsService.close();
  }

  updateTheme(theme: ThemePreference): void {
    this.settingsService.updateTheme(theme);
  }

  updateEditorSetting<K extends keyof ReturnType<typeof this.settings>['editor']>(
    key: K,
    value: ReturnType<typeof this.settings>['editor'][K]
  ): void {
    this.settingsService.updateEditorSetting(key, value);
  }

  updateQuerySetting<K extends keyof ReturnType<typeof this.settings>['query']>(
    key: K,
    value: ReturnType<typeof this.settings>['query'][K]
  ): void {
    this.settingsService.updateQuerySetting(key, value);
  }

  updateGridSetting<K extends keyof ReturnType<typeof this.settings>['grid']>(
    key: K,
    value: ReturnType<typeof this.settings>['grid'][K]
  ): void {
    this.settingsService.updateGridSetting(key, value);
  }

  resetToDefaults(): void {
    this.settingsService.resetToDefaults();
  }
}
