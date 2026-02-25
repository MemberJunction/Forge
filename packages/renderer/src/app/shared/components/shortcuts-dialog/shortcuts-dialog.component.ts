import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface ShortcutCategory {
  name: string;
  shortcuts: Shortcut[];
}

interface Shortcut {
  keys: string;
  description: string;
}

@Component({
  selector: 'app-shortcuts-dialog',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    @if (isOpen()) {
      <div class="shortcuts-overlay" (click)="close()">
        <div class="shortcuts-dialog" (click)="$event.stopPropagation()">
          <div class="dialog-header">
            <h2>Keyboard Shortcuts</h2>
            <button mat-icon-button (click)="close()">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <div class="dialog-content">
            @for (category of categories; track category.name) {
              <div class="shortcut-category">
                <h3>{{ category.name }}</h3>
                <div class="shortcut-list">
                  @for (shortcut of category.shortcuts; track shortcut.description) {
                    <div class="shortcut-item">
                      <span class="shortcut-description">{{ shortcut.description }}</span>
                      <kbd class="shortcut-keys">{{ shortcut.keys }}</kbd>
                    </div>
                  }
                </div>
              </div>
            }
          </div>

          <div class="dialog-footer">
            <p class="hint">Press Esc or click outside to close</p>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .shortcuts-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .shortcuts-dialog {
        width: 700px;
        max-height: 80vh;
        background-color: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);

        h2 {
          margin: 0;
          font-size: var(--font-size-lg);
          font-weight: 600;
        }
      }

      .dialog-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md) var(--spacing-lg);
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-lg);
      }

      .shortcut-category {
        h3 {
          font-size: var(--font-size-sm);
          font-weight: 600;
          text-transform: uppercase;
          color: var(--text-secondary);
          margin: 0 0 var(--spacing-sm);
          padding-bottom: var(--spacing-xs);
          border-bottom: 1px solid var(--border-primary);
        }
      }

      .shortcut-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .shortcut-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-xs) 0;

        .shortcut-description {
          color: var(--text-primary);
          font-size: var(--font-size-sm);
        }
      }

      kbd {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-sm);
        box-shadow: 0 1px 0 var(--border-primary);
        color: var(--text-secondary);
      }

      .dialog-footer {
        padding: var(--spacing-sm) var(--spacing-lg);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
        text-align: center;

        .hint {
          margin: 0;
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }
      }
    `,
  ],
})
export class ShortcutsDialogComponent implements OnInit, OnDestroy {
  readonly isOpen = signal(false);

  readonly categories: ShortcutCategory[] = [
    {
      name: 'General',
      shortcuts: [
        { keys: '⌘ + Shift + P', description: 'Command Palette' },
        { keys: '⌘ + K', description: 'Quick Command Palette' },
        { keys: '⌘ + T', description: 'Quick Object Search' },
        { keys: '⌘ + ,', description: 'Open Settings' },
        { keys: '⌘ + B', description: 'Toggle Sidebar' },
      ],
    },
    {
      name: 'Files & Tabs',
      shortcuts: [
        { keys: '⌘ + N', description: 'New Query Tab' },
        { keys: '⌘ + W', description: 'Close Current Tab' },
        { keys: '⌘ + S', description: 'Save Query' },
        { keys: '⌘ + Shift + S', description: 'Save Query As' },
        { keys: 'Ctrl + Tab', description: 'Next Tab' },
        { keys: 'Ctrl + Shift + Tab', description: 'Previous Tab' },
      ],
    },
    {
      name: 'Query Execution',
      shortcuts: [
        { keys: 'F5 / Ctrl+E / ⌘+Enter', description: 'Execute Query' },
        { keys: 'Escape', description: 'Cancel Query' },
        { keys: '⌘ + Shift + F', description: 'Format SQL' },
      ],
    },
    {
      name: 'Editor',
      shortcuts: [
        { keys: '⌘ + F', description: 'Find' },
        { keys: '⌘ + H', description: 'Find and Replace' },
        { keys: '⌘ + /', description: 'Toggle Comment' },
        { keys: '⌘ + Z', description: 'Undo' },
        { keys: '⌘ + Shift + Z', description: 'Redo' },
        { keys: '⌘ + D', description: 'Select Word' },
        { keys: '⌘ + L', description: 'Select Line' },
      ],
    },
    {
      name: 'Navigation',
      shortcuts: [
        { keys: '⌘ + G', description: 'Go to Line' },
        { keys: '⌘ + P', description: 'Go to File' },
        { keys: 'Ctrl + G', description: 'Go to Definition' },
      ],
    },
    {
      name: 'Results',
      shortcuts: [
        { keys: '⌘ + E', description: 'Export Results' },
        { keys: '⌘ + C', description: 'Copy Selected Cells' },
        { keys: '⌘ + A', description: 'Select All' },
      ],
    },
  ];

  private keydownHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      this.close();
    }
  };

  private eventHandler = () => this.open();

  ngOnInit(): void {
    document.addEventListener('keydown', this.keydownHandler);
    // Listen for custom event to open dialog
    window.addEventListener('forge:show-shortcuts', this.eventHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('forge:show-shortcuts', this.eventHandler);
  }

  open(): void {
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }
}
