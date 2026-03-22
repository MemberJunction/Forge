import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TabStateService, Tab } from '../../core/state/tab.state';
import { ConnectionStateService } from '../../core/state/connection.state';

@Component({
  selector: 'app-tab-bar',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div class="tab-bar-container">
      <div class="tabs-scroll">
        @for (tab of tabState.tabs(); track tab.id) {
          <div
            class="tab"
            [class.active]="tab.id === tabState.activeTabId()"
            [class.dirty]="tab.isDirty"
            (click)="activateTab(tab)"
            (auxclick)="onMiddleClick(tab, $event)"
          >
            <mat-icon class="tab-icon">{{ tab.icon }}</mat-icon>
            <span class="tab-title">{{ tab.title }}</span>
            @if (tab.isDirty) {
              <span class="dirty-indicator"></span>
            }
            @if (tab.type !== 'welcome' || tabState.tabCount() > 1) {
              <button class="close-btn" (click)="closeTab(tab, $event)" matTooltip="Close">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
        }
      </div>
      <div class="tab-actions">
        <button
          mat-icon-button
          matTooltip="New Query Tab"
          (click)="newQueryTab()"
          [disabled]="!canCreateQuery()"
        >
          <mat-icon>add</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .tab-bar-container {
        display: flex;
        align-items: center;
        height: 100%;
        padding: 0 var(--spacing-xs);
        gap: var(--spacing-xs);
      }

      .tabs-scroll {
        display: flex;
        flex: 1;
        overflow-x: auto;
        overflow-y: hidden;
        gap: 1px;

        &::-webkit-scrollbar {
          height: 3px;
        }
      }

      .tab {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: 0 var(--spacing-sm);
        height: calc(var(--tab-height) - 4px);
        background-color: var(--bg-secondary);
        border-radius: var(--radius-sm) var(--radius-sm) 0 0;
        cursor: pointer;
        min-width: 100px;
        max-width: 200px;
        user-select: none;
        position: relative;
        transition: background-color var(--transition-fast);
        color: var(--text-secondary);

        &:hover {
          background-color: var(--bg-hover);
          color: var(--text-primary);
        }

        &.active {
          background-color: var(--bg-primary);
          color: var(--text-primary);

          &::after {
            content: '';
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 2px;
            background-color: var(--border-focus);
          }
        }

        &.dirty .tab-title {
          font-style: italic;
        }
      }

      .tab-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--text-secondary);
      }

      .tab-title {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: var(--font-size-sm);
      }

      .dirty-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: var(--text-secondary);
      }

      .close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        padding: 0;
        background: none;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition:
          opacity var(--transition-fast),
          background-color var(--transition-fast);

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

      .tab:hover .close-btn,
      .tab.active .close-btn {
        opacity: 1;
      }

      .tab-actions {
        display: flex;
        align-items: center;
        padding-left: var(--spacing-sm);
        border-left: 1px solid var(--border-primary);
      }
    `,
  ],
})
export class TabBarComponent {
  readonly tabState = inject(TabStateService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly router = inject(Router);

  activateTab(tab: Tab): void {
    this.tabState.activateTab(tab.id);
    this.navigateToTab(tab);
  }

  closeTab(tab: Tab, event: Event): void {
    event.stopPropagation();
    this.tabState.closeTab(tab.id);

    // Navigate to the new active tab
    const activeTab = this.tabState.activeTab();
    if (activeTab) {
      this.navigateToTab(activeTab);
    }
  }

  onMiddleClick(tab: Tab, event: MouseEvent): void {
    // Middle mouse button
    if (event.button === 1) {
      event.preventDefault();
      this.tabState.closeTab(tab.id);
    }
  }

  newQueryTab(): void {
    const connId = this.connectionState.activeConnectionId();
    const db = this.connectionState.selectedDatabase();
    if (connId && db) {
      this.tabState.openQueryTab(connId, db);
    }
  }

  canCreateQuery(): boolean {
    return this.connectionState.isConnected() && !!this.connectionState.selectedDatabase();
  }

  private navigateToTab(tab: Tab): void {
    switch (tab.type) {
      case 'welcome':
        this.router.navigate(['/']);
        break;
      case 'query':
        this.router.navigate(['/query']);
        break;
      case 'object':
        this.router.navigate(['/explorer']);
        break;
      default:
        this.router.navigate(['/']);
    }
  }
}
