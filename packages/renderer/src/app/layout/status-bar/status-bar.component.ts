import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { CdkOverlayOrigin, OverlayModule } from '@angular/cdk/overlay';
import { ConnectionStateService } from '../../core/state/connection.state';
import { TabStateService } from '../../core/state/tab.state';
import { SettingsService } from '../../core/services/settings.service';
import { IpcService } from '../../core/services/ipc.service';
import { QueryExecutionService } from '../../core/services/query-execution.service';
import { DockerPanelComponent } from '../../shared/components/docker-panel/docker-panel.component';
import type { DockerStatus, DockerContainer } from '@mj-forge/shared';

@Component({
  selector: 'app-status-bar',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatTooltipModule,
    MatButtonModule,
    MatMenuModule,
    OverlayModule,
    DockerPanelComponent,
  ],
  host: {
    '[style.border-top]': 'connectionColorBorder()',
  },
  template: `
    <div class="status-bar-container">
      <div class="status-left">
        @if (connectionState.isConnected()) {
          <div
            class="status-item"
            [class.connected]="connectionState.connectionHealthy()"
            [class.unhealthy]="!connectionState.connectionHealthy()"
            [matTooltip]="connectionState.connectionHealthy() ? 'Connected' : 'Connection lost — attempting to reconnect...'"
          >
            <mat-icon>{{ connectionState.connectionHealthy() ? 'cloud_done' : 'cloud_off' }}</mat-icon>
            <span>{{ connectionState.activeProfile()?.name }}</span>
            @if (!connectionState.connectionHealthy()) {
              <mat-icon class="health-warning spinning">sync</mat-icon>
            }
          </div>
          @if (connectionState.selectedDatabase()) {
            <div class="status-item" matTooltip="Current Database">
              <mat-icon>storage</mat-icon>
              <span>{{ connectionState.selectedDatabase() }}</span>
            </div>
          }
          @if (connectionState.activeProfile()?.isDocker) {
            <div class="status-item docker" matTooltip="Docker Container">
              <span class="docker-icon">🐳</span>
              <span>{{ connectionState.activeProfile()?.dockerContainerId || 'Docker' }}</span>
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
        } @else if (queryExecution.isAnyRunning()) {
          <div class="status-item executing" matTooltip="Running {{ queryExecution.runningCount() }} quer{{ queryExecution.runningCount() === 1 ? 'y' : 'ies' }}">
            <mat-icon class="spinning">hourglass_top</mat-icon>
            <span>Executing{{ queryExecution.runningCount() > 1 ? ' (' + queryExecution.runningCount() + ')' : '' }}...</span>
          </div>
        }
      </div>

      <div class="status-right">
        <div class="status-item" matTooltip="Tabs Open">
          <mat-icon>tab</mat-icon>
          <span>{{ tabState.tabCount() }}</span>
        </div>

        <!-- Docker Status -->
        <button
          class="docker-toggle"
          cdkOverlayOrigin
          #dockerTrigger="cdkOverlayOrigin"
          (click)="toggleDockerPanel()"
          [matTooltip]="dockerTooltip()"
          [class.docker-warning]="!dockerStatus()?.isRunning"
          [class.docker-success]="dockerStatus()?.isRunning && runningContainers() > 0"
        >
          <mat-icon>sailing</mat-icon>
          @if (dockerStatus()?.isRunning && runningContainers() > 0) {
            <span class="docker-count">{{ runningContainers() }}</span>
          }
        </button>

        <!-- Docker Panel Overlay -->
        <ng-template
          cdkConnectedOverlay
          [cdkConnectedOverlayOrigin]="dockerTrigger"
          [cdkConnectedOverlayOpen]="dockerPanelOpen()"
          [cdkConnectedOverlayPositions]="[
            { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 }
          ]"
          [cdkConnectedOverlayHasBackdrop]="true"
          [cdkConnectedOverlayBackdropClass]="'cdk-overlay-transparent-backdrop'"
          (backdropClick)="closeDockerPanel()"
        >
          <app-docker-panel (close)="closeDockerPanel()"></app-docker-panel>
        </ng-template>

        <!-- Theme Toggle -->
        <button
          class="theme-toggle"
          [matMenuTriggerFor]="themeMenu"
          [matTooltip]="'Theme: ' + themeLabel()"
        >
          <mat-icon>{{ themeIcon() }}</mat-icon>
        </button>
        <mat-menu #themeMenu="matMenu">
          <button mat-menu-item (click)="setTheme('system')">
            <mat-icon>computer</mat-icon>
            <span>System</span>
            @if (settings.theme() === 'system') {
              <mat-icon class="check-icon">check</mat-icon>
            }
          </button>
          <button mat-menu-item (click)="setTheme('light')">
            <mat-icon>light_mode</mat-icon>
            <span>Light</span>
            @if (settings.theme() === 'light') {
              <mat-icon class="check-icon">check</mat-icon>
            }
          </button>
          <button mat-menu-item (click)="setTheme('dark')">
            <mat-icon>dark_mode</mat-icon>
            <span>Dark</span>
            @if (settings.theme() === 'dark') {
              <mat-icon class="check-icon">check</mat-icon>
            }
          </button>
        </mat-menu>

        @if (cursorLine() > 0) {
          <div class="status-item cursor-info" matTooltip="Line:Column">
            <span>Ln {{ cursorLine() }}, Col {{ cursorColumn() }}</span>
          </div>
        }

        <div class="status-item version">
          <span>MJ Forge {{ appVersion() ? 'v' + appVersion() : '' }}</span>
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

        &.unhealthy mat-icon {
          color: var(--status-warning);
        }

        .health-warning {
          font-size: 12px;
          width: 12px;
          height: 12px;
          margin-left: 2px;
        }
      }

      .executing mat-icon {
        color: var(--status-warning);
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

      .docker {
        .docker-icon {
          font-size: 12px;
        }
      }

      .theme-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }

      .check-icon {
        margin-left: auto;
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--status-success);
      }

      .docker-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        height: 24px;
        padding: 0 var(--spacing-xs);
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: background-color var(--transition-fast);
        border: none;
        background: transparent;
        color: var(--text-secondary);

        &:hover {
          background-color: var(--bg-hover);
        }

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }

        .docker-count {
          font-size: 10px;
          font-weight: 600;
          background-color: var(--status-success);
          color: white;
          border-radius: 50%;
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        &.docker-warning mat-icon {
          color: var(--status-warning);
        }

        &.docker-success mat-icon {
          color: var(--status-success);
        }
      }
    `,
  ],
})
export class StatusBarComponent implements OnInit {
  readonly connectionState = inject(ConnectionStateService);
  readonly tabState = inject(TabStateService);
  readonly settings = inject(SettingsService);
  readonly queryExecution = inject(QueryExecutionService);
  private readonly ipc = inject(IpcService);

  // Docker state
  readonly dockerStatus = signal<DockerStatus | null>(null);
  readonly containers = signal<DockerContainer[]>([]);
  readonly dockerPanelOpen = signal(false);
  readonly appVersion = signal('');

  // Cursor position from active editor
  readonly cursorLine = signal(0);
  readonly cursorColumn = signal(0);

  readonly connectionColorBorder = computed(() => {
    const profile = this.connectionState.activeProfile();
    if (profile?.color) {
      return `3px solid ${profile.color}`;
    }
    return '';
  });

  readonly runningContainers = computed(() =>
    this.containers().filter(c => c.status === 'running').length
  );

  readonly dockerTooltip = computed(() => {
    const status = this.dockerStatus();
    if (!status) return 'Checking Docker...';
    if (!status.isAvailable) return 'Docker not available';
    if (!status.isRunning) return 'Docker not running';
    const running = this.runningContainers();
    const total = this.containers().length;
    if (total === 0) return 'No SQL Server containers';
    return `Docker: ${running}/${total} containers running`;
  });

  readonly themeIcon = computed(() => {
    const theme = this.settings.theme();
    switch (theme) {
      case 'light':
        return 'light_mode';
      case 'dark':
        return 'dark_mode';
      default:
        return 'computer';
    }
  });

  readonly themeLabel = computed(() => {
    const theme = this.settings.theme();
    switch (theme) {
      case 'light':
        return 'Light';
      case 'dark':
        return 'Dark';
      default:
        return 'System';
    }
  });

  async ngOnInit(): Promise<void> {
    await this.checkDockerStatus();
    // Poll Docker status every 30 seconds
    setInterval(() => this.checkDockerStatus(), 30000);

    // Load dynamic version
    if (this.ipc.isAvailable) {
      this.ipc.getAppVersion().subscribe(v => this.appVersion.set(v));
    }

    // Listen for cursor position updates from query editors
    window.addEventListener('forge:cursor-position', ((e: CustomEvent) => {
      this.cursorLine.set(e.detail?.line ?? 0);
      this.cursorColumn.set(e.detail?.column ?? 0);
    }) as EventListener);
  }

  private async checkDockerStatus(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const status = await this.ipc.detectDocker().toPromise();
      this.dockerStatus.set(status ?? null);

      if (status?.isAvailable && status?.isRunning) {
        const containers = await this.ipc.getDockerContainers().toPromise();
        this.containers.set(containers?.filter(c => c.isSqlServer) ?? []);
      } else {
        this.containers.set([]);
      }
    } catch {
      this.dockerStatus.set(null);
    }
  }

  toggleDockerPanel(): void {
    this.dockerPanelOpen.update(v => !v);
  }

  closeDockerPanel(): void {
    this.dockerPanelOpen.set(false);
    // Refresh status when panel closes
    this.checkDockerStatus();
  }

  setTheme(theme: 'system' | 'light' | 'dark'): void {
    this.settings.updateTheme(theme);
  }
}
