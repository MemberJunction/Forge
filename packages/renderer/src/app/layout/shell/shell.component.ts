import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { TabBarComponent } from '../tab-bar/tab-bar.component';
import { StatusBarComponent } from '../status-bar/status-bar.component';
import { ConnectionStateService } from '../../core/state/connection.state';
import { MenuService } from '../../core/services/menu.service';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, TabBarComponent, StatusBarComponent],
  template: `
    <div class="shell">
      @if (!sidebarHidden()) {
        <app-sidebar class="sidebar" />
      }
      <div class="main-area">
        <app-tab-bar class="tab-bar" />
        <div class="content-area">
          <router-outlet />
        </div>
        <app-status-bar class="status-bar" />
      </div>
    </div>
  `,
  styles: [
    `
      .shell {
        display: flex;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
        background-color: var(--bg-primary);
      }

      .sidebar {
        width: var(--sidebar-width);
        min-width: var(--sidebar-width);
        max-width: var(--sidebar-width);
        height: 100%;
        border-right: 1px solid var(--border-primary);
        background-color: var(--bg-secondary);
      }

      .main-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        height: 100%;
      }

      .tab-bar {
        flex-shrink: 0;
        height: var(--tab-height);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
      }

      .content-area {
        flex: 1;
        overflow: auto;
        background-color: var(--bg-primary);
      }

      .status-bar {
        flex-shrink: 0;
        height: var(--status-bar-height);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
      }
    `,
  ],
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly connectionState = inject(ConnectionStateService);
  private readonly menuService = inject(MenuService);

  readonly sidebarHidden = signal(false);
  private subscriptions: Subscription[] = [];

  ngOnInit(): void {
    // Load saved connection profiles on startup
    this.connectionState.loadProfiles();

    // Listen for sidebar toggle from menu
    this.subscriptions.push(
      this.menuService.toggleSidebar$.subscribe(() => {
        this.sidebarHidden.update(hidden => !hidden);
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}
