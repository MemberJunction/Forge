import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConnectionStateService } from '../../core/state/connection.state';
import { TabStateService } from '../../core/state/tab.state';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="status-bar-container">
      <div class="status-left">
        @if (connectionState.isConnected()) {
          <div class="status-item connected" matTooltip="Connected">
            <mat-icon>cloud_done</mat-icon>
            <span>{{ connectionState.activeProfile()?.name }}</span>
          </div>
          @if (connectionState.selectedDatabase()) {
            <div class="status-item" matTooltip="Current Database">
              <mat-icon>storage</mat-icon>
              <span>{{ connectionState.selectedDatabase() }}</span>
            </div>
          }
        } @else {
          <div class="status-item disconnected" matTooltip="Not Connected">
            <mat-icon>cloud_off</mat-icon>
            <span>Not Connected</span>
          </div>
        }
      </div>

      <div class="status-center">
        @if (connectionState.connecting()) {
          <div class="status-item">
            <mat-icon class="spinning">sync</mat-icon>
            <span>Connecting...</span>
          </div>
        }
      </div>

      <div class="status-right">
        <div class="status-item" matTooltip="Tabs Open">
          <mat-icon>tab</mat-icon>
          <span>{{ tabState.tabCount() }}</span>
        </div>
        <div class="status-item version">
          <span>MJ Forge v1.0.0</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .status-bar-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 100%;
        padding: 0 var(--spacing-md);
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
      }

      .status-left,
      .status-center,
      .status-right {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
      }

      .status-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }

        &.connected mat-icon {
          color: var(--status-success);
        }

        &.disconnected mat-icon {
          color: var(--text-muted);
        }
      }

      .spinning {
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .version {
        opacity: 0.7;
      }
    `,
  ],
})
export class StatusBarComponent {
  readonly connectionState = inject(ConnectionStateService);
  readonly tabState = inject(TabStateService);
}
