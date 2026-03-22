import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { ConnectionStateService } from '../../core/state/connection.state';
import { ExplorerStateService } from '../../core/state/explorer.state';
import { IpcService } from '../../core/services/ipc.service';
import {
  ConnectionDialogComponent,
  ConnectionDialogData,
} from '../../shared/components/connection-dialog/connection-dialog.component';
import type { DockerStatus, DockerContainer } from '@mj-forge/shared';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatCardModule],
  template: `
    <div class="welcome-container">
      <div class="welcome-header">
        <div class="logo-section">
          <mat-icon class="app-logo">storage</mat-icon>
          <h1>MJ Forge</h1>
          <p class="tagline">SQL Server Management for macOS</p>
        </div>
      </div>

      <div class="welcome-content">
        <!-- Quick Actions -->
        <section class="quick-actions">
          <h2>Quick Actions</h2>
          <div class="action-cards">
            <mat-card class="action-card" (click)="newConnection()">
              <mat-icon>add_circle</mat-icon>
              <h3>New Connection</h3>
              <p>Connect to a SQL Server instance</p>
            </mat-card>

            @if (connectionState.hasProfiles()) {
              <mat-card class="action-card" (click)="reconnect()">
                <mat-icon>refresh</mat-icon>
                <h3>Recent Connection</h3>
                <p>{{ recentConnectionName }}</p>
              </mat-card>
            }

            <mat-card class="action-card" (click)="openDockerSection()">
              <mat-icon>sailing</mat-icon>
              <h3>Docker Containers</h3>
              <p>{{ dockerStatusText }}</p>
            </mat-card>
          </div>
        </section>

        <!-- Recent Connections -->
        @if (connectionState.hasProfiles()) {
          <section class="recent-connections">
            <h2>Recent Connections</h2>
            <div class="connection-list">
              @for (profile of connectionState.profiles().slice(0, 5); track profile.id) {
                <div class="connection-item" (click)="quickConnect(profile)">
                  <mat-icon>dns</mat-icon>
                  <div class="connection-info">
                    <span class="connection-name">{{ profile.name }}</span>
                    <span class="connection-server">{{ profile.server }}:{{ profile.port }}</span>
                  </div>
                  <mat-icon class="connect-icon">arrow_forward</mat-icon>
                </div>
              }
            </div>
          </section>
        }

        <!-- Docker Containers -->
        @if (dockerStatus?.isAvailable && sqlContainers.length > 0) {
          <section class="docker-section">
            <h2>SQL Server Containers</h2>
            <div class="container-list">
              @for (container of sqlContainers; track container.id) {
                <div class="container-item">
                  <mat-icon [class.running]="container.state === 'running'">
                    {{ container.state === 'running' ? 'play_circle' : 'pause_circle' }}
                  </mat-icon>
                  <div class="container-info">
                    <span class="container-name">{{ container.name }}</span>
                    <span class="container-status">{{ container.status }}</span>
                  </div>
                  @if (container.state === 'running') {
                    <button mat-stroked-button (click)="connectToContainer(container)">
                      Connect
                    </button>
                  } @else {
                    <button mat-stroked-button (click)="startContainer(container)">Start</button>
                  }
                </div>
              }
            </div>
          </section>
        }

        <!-- Getting Started -->
        <section class="getting-started">
          <h2>Getting Started</h2>
          <div class="tips">
            <div class="tip">
              <mat-icon>lightbulb</mat-icon>
              <div>
                <h4>Connect to SQL Server</h4>
                <p>
                  MJ Forge connects to SQL Server instances via TCP/IP. Make sure your server has
                  TCP/IP enabled and is accessible from your Mac.
                </p>
              </div>
            </div>
            <div class="tip">
              <mat-icon>sailing</mat-icon>
              <div>
                <h4>Use Docker for Local Development</h4>
                <p>
                  Running SQL Server in Docker is the easiest way to develop locally on macOS. MJ
                  Forge can detect and manage your SQL Server containers.
                </p>
              </div>
            </div>
            <div class="tip">
              <mat-icon>security</mat-icon>
              <div>
                <h4>Secure Credential Storage</h4>
                <p>
                  Your connection credentials are securely stored in macOS Keychain, never in plain
                  text files.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div class="welcome-footer">
        <p>
          Built with
          <mat-icon inline>favorite</mat-icon>
          by MemberJunction
        </p>
        <a href="#" (click)="openDocs($event)">Documentation</a>
        <span class="separator">|</span>
        <a href="#" (click)="openGitHub($event)">GitHub</a>
      </div>
    </div>
  `,
  styles: [
    `
      .welcome-container {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        padding: var(--spacing-xl);
        overflow-y: auto;
      }

      .welcome-header {
        text-align: center;
        padding: var(--spacing-xl) 0;
      }

      .logo-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-sm);

        .app-logo {
          font-size: 64px;
          width: 64px;
          height: 64px;
          color: var(--status-info);
        }

        h1 {
          font-size: 32px;
          font-weight: 700;
          margin: 0;
          color: var(--text-primary);
        }

        .tagline {
          color: var(--text-secondary);
          margin: 0;
        }
      }

      .welcome-content {
        flex: 1;
        max-width: 900px;
        margin: 0 auto;
        width: 100%;
      }

      section {
        margin-bottom: var(--spacing-xl);

        h2 {
          font-size: var(--font-size-lg);
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: var(--spacing-md);
        }
      }

      .action-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--spacing-md);
      }

      .action-card {
        padding: var(--spacing-lg);
        cursor: pointer;
        transition:
          background-color var(--transition-fast),
          transform var(--transition-fast);
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);

        &:hover {
          background-color: var(--bg-hover);
          transform: translateY(-2px);
        }

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          color: var(--status-info);
          margin-bottom: var(--spacing-sm);
        }

        h3 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: 0 0 var(--spacing-xs);
          color: var(--text-primary);
        }

        p {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          margin: 0;
        }
      }

      .connection-list,
      .container-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .connection-item,
      .container-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background-color: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        mat-icon {
          color: var(--text-secondary);

          &.running {
            color: var(--status-success);
          }
        }

        .connection-info,
        .container-info {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .connection-name,
        .container-name {
          font-weight: 500;
          color: var(--text-primary);
        }

        .connection-server,
        .container-status {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }

        .connect-icon {
          opacity: 0;
          transition: opacity var(--transition-fast);
        }

        &:hover .connect-icon {
          opacity: 1;
        }
      }

      .tips {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .tip {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background-color: var(--bg-secondary);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--status-info);

        mat-icon {
          color: var(--status-info);
          flex-shrink: 0;
        }

        h4 {
          font-size: var(--font-size-md);
          font-weight: 600;
          margin: 0 0 var(--spacing-xs);
          color: var(--text-primary);
        }

        p {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
          margin: 0;
          line-height: 1.5;
        }
      }

      .welcome-footer {
        text-align: center;
        padding: var(--spacing-lg) 0;
        color: var(--text-muted);
        font-size: var(--font-size-sm);

        mat-icon {
          font-size: 14px;
          vertical-align: middle;
          color: #e91e63;
        }

        a {
          color: var(--text-accent);
          margin: 0 var(--spacing-xs);
        }

        .separator {
          color: var(--border-primary);
        }
      }
    `,
  ],
})
export class WelcomeComponent implements OnInit {
  readonly connectionState = inject(ConnectionStateService);
  private readonly explorerState = inject(ExplorerStateService);
  private readonly ipc = inject(IpcService);
  private readonly dialog = inject(MatDialog);

  dockerStatus: DockerStatus | null = null;
  sqlContainers: DockerContainer[] = [];

  get recentConnectionName(): string {
    const profiles = this.connectionState.profiles();
    return profiles.length > 0 ? profiles[0].name : 'None';
  }

  get dockerStatusText(): string {
    if (!this.dockerStatus) return 'Checking...';
    if (!this.dockerStatus.isAvailable) return 'Docker not available';
    if (this.sqlContainers.length === 0) return 'No SQL Server containers';
    const running = this.sqlContainers.filter(c => c.state === 'running').length;
    return `${running}/${this.sqlContainers.length} running`;
  }

  ngOnInit(): void {
    this.checkDocker();
  }

  private async checkDocker(): Promise<void> {
    try {
      const status = await this.ipc.detectDocker().toPromise();
      this.dockerStatus = status ?? null;
      if (this.dockerStatus?.isAvailable) {
        const containers = await this.ipc.getDockerContainers().toPromise();
        this.sqlContainers = containers?.filter(c => c.isSqlServer) ?? [];
      }
    } catch {
      // Docker not available, that's fine
    }
  }

  newConnection(): void {
    this.dialog.open(ConnectionDialogComponent, {
      data: {} as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  reconnect(): void {
    const profiles = this.connectionState.profiles();
    if (profiles.length > 0) {
      this.connectTo(profiles[0].id);
    }
  }

  quickConnect(profile: { id: string }): void {
    this.connectTo(profile.id);
  }

  async connectTo(profileId: string): Promise<void> {
    const success = await this.connectionState.connect(profileId);
    if (success) {
      const profile = this.connectionState.getProfile(profileId);
      if (profile) {
        this.explorerState.addServerNode(profileId, profile.name);
        this.explorerState.expandNode(`server-${profileId}`);
      }
    }
  }

  openDockerSection(): void {
    const section = document.querySelector('.docker-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  connectToContainer(container: DockerContainer): void {
    // Open connection dialog with container info pre-filled
    this.dialog.open(ConnectionDialogComponent, {
      data: {
        server: 'localhost',
        port: container.ports?.[0]?.external || 1433,
      } as ConnectionDialogData,
      width: '540px',
      maxHeight: '90vh',
    });
  }

  async startContainer(container: DockerContainer): Promise<void> {
    await this.ipc.startDockerContainer(container.id).toPromise();
    await this.checkDocker();
  }

  openDocs(event: Event): void {
    event.preventDefault();
    this.ipc.openExternal('https://github.com/MemberJunction/mj-forge/wiki').subscribe();
  }

  openGitHub(event: Event): void {
    event.preventDefault();
    this.ipc.openExternal('https://github.com/MemberJunction/mj-forge').subscribe();
  }
}
