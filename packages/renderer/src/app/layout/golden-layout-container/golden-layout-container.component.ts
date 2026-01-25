import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChild,
  ElementRef,
  ApplicationRef,
  EnvironmentInjector,
  createComponent,
  ComponentRef,
  inject,
  ChangeDetectorRef,
  HostListener,
  Output,
  EventEmitter,
  Type,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  GoldenLayoutManager,
  TabComponentState,
  TabShownEvent,
} from '../../core/services/golden-layout-manager.service';
import { TabStateService, Tab } from '../../core/state/tab.state';
import { WelcomeComponent } from '../../features/welcome/welcome.component';
import { QueryComponent } from '../../features/query/query.component';
import { ExplorerComponent } from '../../features/explorer/explorer.component';
import { ErdComponent } from '../../features/erd/erd.component';
import type { LayoutConfig } from '@mj-forge/shared';

/**
 * Container for Golden Layout tabs with dockable panel support.
 *
 * Handles:
 * - Golden Layout initialization
 * - Tab creation and content rendering
 * - Lazy loading of tab content
 * - Context menu for pin/close
 * - Layout persistence
 */
@Component({
  selector: 'app-golden-layout-container',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="golden-layout-wrapper">
      <div #glContainer class="gl-container"></div>
    </div>

    <!-- Context Menu -->
    @if (contextMenuVisible) {
      <div class="context-menu" [style.left.px]="contextMenuX" [style.top.px]="contextMenuY">
        <div class="context-menu-item" (click)="onContextPin()">
          <span class="material-icons">{{ isContextTabPinned ? 'push_pin' : 'push_pin' }}</span>
          <span>{{ isContextTabPinned ? 'Unpin Tab' : 'Pin Tab' }}</span>
        </div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" (click)="onContextClose()">
          <span class="material-icons">close</span>
          <span>Close Tab</span>
        </div>
        <div class="context-menu-item" (click)="onContextCloseOthers()">
          <span class="material-icons">close_fullscreen</span>
          <span>Close Other Tabs</span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex: 1;
        height: 100%;
        width: 100%;
        overflow: hidden;
      }

      .golden-layout-wrapper {
        display: flex;
        flex-direction: column;
        flex: 1;
        width: 100%;
        overflow: hidden;
      }

      .gl-container {
        flex: 1;
        width: 100%;
        height: 100%;
        position: relative;
        background: var(--bg-primary);
      }

      /* Context Menu */
      .context-menu {
        position: fixed;
        background: var(--bg-elevated);
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        box-shadow: var(--shadow-lg);
        min-width: 150px;
        z-index: 10001;
        overflow: hidden;
      }

      .context-menu .context-menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        cursor: pointer;
        font-size: 13px;
        color: var(--text-primary);
        transition: background var(--transition-fast);
      }

      .context-menu .context-menu-item .material-icons {
        font-size: 16px;
        color: var(--text-secondary);
      }

      .context-menu .context-menu-item:hover {
        background: var(--bg-hover);
      }

      .context-menu .context-menu-divider {
        height: 1px;
        background: var(--border-primary);
        margin: 4px 0;
      }
    `,
  ],
})
export class GoldenLayoutContainerComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('glContainer', { static: false }) glContainer!: ElementRef<HTMLDivElement>;

  @Output() layoutInitError = new EventEmitter<void>();

  private readonly layoutManager = inject(GoldenLayoutManager);
  private readonly tabState = inject(TabStateService);
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly cdr = inject(ChangeDetectorRef);

  private subscriptions: Subscription[] = [];
  private layoutInitRetryCount = 0;
  private readonly MAX_LAYOUT_INIT_RETRIES = 5;
  private layoutInitialized = false;
  private layoutRestorationComplete = false;

  // Track component references for cleanup
  private componentRefs = new Map<string, ComponentRef<unknown>>();

  // Context menu state
  contextMenuVisible = false;
  contextMenuX = 0;
  contextMenuY = 0;
  contextMenuTabId: string | null = null;

  ngOnInit(): void {
    // Subscribe to tab events from Golden Layout
    this.subscriptions.push(
      this.layoutManager.TabShown.subscribe(event => {
        this.onTabShown(event);
      }),
      this.layoutManager.TabClosed.subscribe(tabId => {
        this.cleanupTabComponent(tabId);
        this.tabState.closeTab(tabId);
      }),
      this.layoutManager.LayoutChanged.subscribe(() => {
        const layout = this.layoutManager.SaveLayout();
        this.saveLayoutState(layout);
      }),
      this.layoutManager.ActiveTab.subscribe(tabId => {
        if (tabId) {
          this.tabState.activateTab(tabId);
        }
      }),
      this.layoutManager.TabDoubleClicked.subscribe(tabId => {
        this.tabState.togglePin(tabId);
      }),
      this.layoutManager.TabRightClicked.subscribe(event => {
        this.showContextMenu(event.x, event.y, event.tabId);
      })
    );

    // Subscribe to tab state changes to sync with Golden Layout
    this.subscriptions.push(
      this.tabState.tabs$.subscribe(tabs => {
        if (this.layoutRestorationComplete) {
          this.syncTabsWithGoldenLayout(tabs);
        }
      })
    );
  }

  ngAfterViewInit(): void {
    this.initializeGoldenLayout();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());

    // Cleanup all component refs
    this.componentRefs.forEach((ref, _tabId) => {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
    });
    this.componentRefs.clear();

    this.layoutManager.Destroy();
  }

  /**
   * Handle window resize events
   */
  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.layoutInitialized) {
      this.layoutManager.updateSize();
    }
  }

  /**
   * Initialize Golden Layout and load tabs
   */
  private initializeGoldenLayout(): void {
    if (!this.glContainer?.nativeElement) {
      this.layoutInitRetryCount++;

      if (this.layoutInitRetryCount > this.MAX_LAYOUT_INIT_RETRIES) {
        console.error(
          `Golden Layout container not available after ${this.MAX_LAYOUT_INIT_RETRIES} retries`
        );
        this.layoutInitError.emit();
        return;
      }

      console.warn(
        `Golden Layout container not available, retry ${this.layoutInitRetryCount}/${this.MAX_LAYOUT_INIT_RETRIES}...`
      );
      setTimeout(() => this.initializeGoldenLayout(), 50);
      return;
    }

    this.layoutInitRetryCount = 0;

    if (this.layoutInitialized) {
      return;
    }

    // Initialize Golden Layout
    this.layoutManager.Initialize(this.glContainer.nativeElement);
    this.layoutInitialized = true;

    // Create tabs from current state - use bulk add for reliability
    const tabs = this.tabState.tabs();
    if (tabs.length > 0) {
      // Convert all tabs to TabComponentState at once
      const tabStates = tabs.map(tab => this.createTabState(tab));

      // Add all tabs at once for reliable initialization
      this.layoutManager.AddMultipleTabs(tabStates);

      // Focus active tab
      const activeTabId = this.tabState.activeTabId();
      if (activeTabId) {
        setTimeout(() => {
          this.layoutManager.FocusTab(activeTabId);
        }, 100);
      }
    }

    this.layoutRestorationComplete = true;
  }

  /**
   * Create TabComponentState from Tab
   */
  private createTabState(tab: Tab): TabComponentState {
    return {
      tabId: tab.id,
      tabType: tab.type,
      connectionId: tab.connectionId,
      databaseName: tab.databaseName,
      title: tab.title,
      icon: tab.icon,
      isPinned: tab.isPinned ?? false,
      isLoaded: false,
      configuration: {
        content: tab.content,
        autoExecute: tab.autoExecute,
        ...tab.metadata,
      },
    };
  }

  /**
   * Create a tab in Golden Layout from Tab state
   */
  private createTabInLayout(tab: Tab): void {
    const state = this.createTabState(tab);
    this.layoutManager.AddTab(state);
  }

  /**
   * Handle tab shown event for lazy loading
   */
  private async onTabShown(event: TabShownEvent): Promise<void> {
    if (event.isFirstShow) {
      await this.loadTabContent(event.tabId, event.container);
      this.layoutManager.MarkTabLoaded(event.tabId);
    }
  }

  /**
   * Load content into a tab container
   */
  private async loadTabContent(tabId: string, container: { element: HTMLElement }): Promise<void> {
    try {
      const tab = this.tabState.tabs().find(t => t.id === tabId);
      if (!tab) {
        console.error(`Tab not found: ${tabId}`);
        return;
      }

      // Get the component type for this tab
      const componentType = this.getComponentTypeForTab(tab);
      if (!componentType) {
        console.error(`Unknown tab type: ${tab.type}`);
        return;
      }

      // Clear loading placeholder
      container.element.innerHTML = '';

      // Create the component dynamically
      const componentRef = createComponent(componentType, {
        environmentInjector: this.environmentInjector,
      });

      // Attach to Angular's change detection
      this.appRef.attachView(componentRef.hostView);

      // Set inputs on the component based on tab type
      this.setComponentInputs(componentRef.instance, tab);

      // Create a container div for the component
      const componentElement = document.createElement('div');
      componentElement.className = 'tab-content-wrapper';
      componentElement.style.cssText =
        'width: 100%; height: 100%; display: flex; flex-direction: column;';

      // Append the component's native element
      const nativeElement = (componentRef.hostView as unknown as { rootNodes: HTMLElement[] })
        .rootNodes[0];
      componentElement.appendChild(nativeElement);

      // Add to Golden Layout container
      container.element.appendChild(componentElement);

      // Store reference for cleanup
      this.componentRefs.set(tabId, componentRef);
    } catch (e) {
      console.error('Failed to load tab content:', e);
    }
  }

  /**
   * Get the component type for a tab
   */
  private getComponentTypeForTab(tab: Tab): Type<unknown> | null {
    const componentMap: Record<string, Type<unknown>> = {
      welcome: WelcomeComponent,
      query: QueryComponent,
      object: ExplorerComponent,
      erd: ErdComponent,
    };

    return componentMap[tab.type] || null;
  }

  /**
   * Set inputs on a component instance based on tab data
   */
  private setComponentInputs(instance: unknown, tab: Tab): void {
    // For query component, pass tab reference for content sync
    if (tab.type === 'query' && instance) {
      const queryInstance = instance as { tabId?: string };
      if ('tabId' in queryInstance) {
        queryInstance.tabId = tab.id;
      }
    }

    // For ERD component, pass metadata
    if (tab.type === 'erd' && instance && tab.metadata) {
      const erdInstance = instance as { tableName?: string; schema?: string };
      if ('tableName' in erdInstance && tab.metadata['tableName']) {
        erdInstance.tableName = tab.metadata['tableName'] as string;
      }
      if ('schema' in erdInstance && tab.metadata['schema']) {
        erdInstance.schema = tab.metadata['schema'] as string;
      }
    }
  }

  /**
   * Cleanup a tab's component
   */
  private cleanupTabComponent(tabId: string): void {
    const componentRef = this.componentRefs.get(tabId);
    if (componentRef) {
      this.appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      this.componentRefs.delete(tabId);
    }
  }

  /**
   * Sync tabs with Golden Layout
   */
  private syncTabsWithGoldenLayout(tabs: Tab[]): void {
    // Get existing tab IDs from Golden Layout
    const existingTabIds = this.layoutManager.GetAllTabIds();
    const configTabIds = tabs.map(tab => tab.id);

    // Remove tabs that are no longer in state
    existingTabIds.forEach(tabId => {
      if (!configTabIds.includes(tabId)) {
        this.layoutManager.RemoveTab(tabId);
      }
    });

    // Add tabs that don't exist yet
    tabs.forEach(tab => {
      if (!existingTabIds.includes(tab.id)) {
        this.createTabInLayout(tab);
      } else {
        // Update styling for existing tabs
        this.layoutManager.UpdateTabStyle(tab.id, {
          isPinned: tab.isPinned ?? false,
          title: tab.title,
        });
      }
    });
  }

  /**
   * Save layout state (would be called by persistence layer)
   */
  private saveLayoutState(_layout: LayoutConfig): void {
    // TODO: Implement persistence via IPC
    // This would save to the app state file
  }

  /**
   * Show context menu
   */
  showContextMenu(x: number, y: number, tabId: string): void {
    this.contextMenuX = x;
    this.contextMenuY = y;
    this.contextMenuTabId = tabId;
    this.contextMenuVisible = true;
    this.cdr.detectChanges();

    // Close menu when clicking outside
    setTimeout(() => {
      const clickHandler = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.context-menu')) {
          this.hideContextMenu();
          document.removeEventListener('click', clickHandler);
          document.removeEventListener('keydown', keyHandler);
        }
      };

      const keyHandler = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          this.hideContextMenu();
          document.removeEventListener('click', clickHandler);
          document.removeEventListener('keydown', keyHandler);
        }
      };

      document.addEventListener('click', clickHandler);
      document.addEventListener('keydown', keyHandler);
    }, 0);
  }

  /**
   * Hide context menu
   */
  hideContextMenu(): void {
    this.contextMenuVisible = false;
    this.contextMenuTabId = null;
    this.cdr.detectChanges();
  }

  /**
   * Check if context menu tab is pinned
   */
  get isContextTabPinned(): boolean {
    if (!this.contextMenuTabId) return false;
    const tab = this.tabState.tabs().find(t => t.id === this.contextMenuTabId);
    return tab?.isPinned ?? false;
  }

  /**
   * Toggle pin from context menu
   */
  onContextPin(): void {
    if (this.contextMenuTabId) {
      this.tabState.togglePin(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }

  /**
   * Close tab from context menu
   */
  onContextClose(): void {
    if (this.contextMenuTabId) {
      this.layoutManager.RemoveTab(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }

  /**
   * Close all other tabs from context menu
   */
  onContextCloseOthers(): void {
    if (this.contextMenuTabId) {
      this.tabState.closeOtherTabs(this.contextMenuTabId);
    }
    this.hideContextMenu();
  }
}
