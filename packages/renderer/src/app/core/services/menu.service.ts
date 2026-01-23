import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { ConnectionStateService } from '../state/connection.state';
import { TabStateService } from '../state/tab.state';
import { ExplorerStateService } from '../state/explorer.state';

@Injectable({ providedIn: 'root' })
export class MenuService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly explorerState = inject(ExplorerStateService);

  // Events that components can subscribe to
  readonly executeQuery$ = new Subject<void>();
  readonly executeSelection$ = new Subject<void>();
  readonly cancelQuery$ = new Subject<void>();
  readonly saveQuery$ = new Subject<void>();
  readonly saveQueryAs$ = new Subject<void>();
  readonly openQuery$ = new Subject<void>();
  readonly find$ = new Subject<void>();
  readonly replace$ = new Subject<void>();
  readonly toggleSidebar$ = new Subject<void>();

  private unsubscribers: (() => void)[] = [];

  constructor() {
    this.setupMenuListeners();
  }

  private setupMenuListeners(): void {
    const menu = window.forge?.menu;
    if (!menu) {
      console.warn('MenuService: Menu API not available');
      return;
    }

    // Connection menu items
    this.unsubscribers.push(
      menu.onNewConnection(() => {
        this.zone.run(() => this.router.navigate(['/connections']));
      })
    );

    this.unsubscribers.push(
      menu.onDisconnect(() => {
        this.zone.run(() => this.connectionState.disconnect());
      })
    );

    this.unsubscribers.push(
      menu.onRefresh(() => {
        this.zone.run(() => this.refresh());
      })
    );

    // Query menu items
    this.unsubscribers.push(
      menu.onNewQuery(() => {
        this.zone.run(() => this.newQuery());
      })
    );

    this.unsubscribers.push(
      menu.onOpenQuery(() => {
        this.zone.run(() => this.openQuery$.next());
      })
    );

    this.unsubscribers.push(
      menu.onSaveQuery(() => {
        this.zone.run(() => this.saveQuery$.next());
      })
    );

    this.unsubscribers.push(
      menu.onSaveQueryAs(() => {
        this.zone.run(() => this.saveQueryAs$.next());
      })
    );

    this.unsubscribers.push(
      menu.onExecuteQuery(() => {
        this.zone.run(() => this.executeQuery$.next());
      })
    );

    this.unsubscribers.push(
      menu.onExecuteSelection(() => {
        this.zone.run(() => this.executeSelection$.next());
      })
    );

    this.unsubscribers.push(
      menu.onCancelQuery(() => {
        this.zone.run(() => this.cancelQuery$.next());
      })
    );

    // Edit menu items
    this.unsubscribers.push(
      menu.onFind(() => {
        this.zone.run(() => this.find$.next());
      })
    );

    this.unsubscribers.push(
      menu.onReplace(() => {
        this.zone.run(() => this.replace$.next());
      })
    );

    // View menu items
    this.unsubscribers.push(
      menu.onToggleSidebar(() => {
        this.zone.run(() => this.toggleSidebar$.next());
      })
    );

    // Database menu items
    this.unsubscribers.push(
      menu.onBackup(() => {
        this.zone.run(() => this.router.navigate(['/backup']));
      })
    );

    this.unsubscribers.push(
      menu.onRestore(() => {
        this.zone.run(() => this.router.navigate(['/restore']));
      })
    );
  }

  private newQuery(): void {
    const connectionId = this.connectionState.activeConnectionId();
    const databaseName = this.connectionState.selectedDatabase();

    if (connectionId && databaseName) {
      this.tabState.openQueryTab(connectionId, databaseName);
      this.router.navigate(['/query']);
    } else {
      // Navigate to connections if not connected
      this.router.navigate(['/connections']);
    }
  }

  private async refresh(): Promise<void> {
    if (this.connectionState.isConnected()) {
      await this.connectionState.loadDatabases();
      const selectedNode = this.explorerState.selectedNodeId();
      if (selectedNode) {
        await this.explorerState.refreshNode(selectedNode);
      }
    }
  }

  ngOnDestroy(): void {
    this.unsubscribers.forEach(unsub => unsub());
  }
}
