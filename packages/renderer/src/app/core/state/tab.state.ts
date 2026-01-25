import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { IpcService } from '../services/ipc.service';
import type { TabState } from '@mj-forge/shared';
import { firstValueFrom } from 'rxjs';

export type TabType = 'query' | 'results' | 'object' | 'welcome' | 'erd';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  icon: string;
  connectionId?: string;
  databaseName?: string;
  content?: string; // For query tabs, the SQL content
  isDirty?: boolean;
  isPinned?: boolean; // For GoldenLayout, whether tab is pinned
  autoExecute?: boolean; // For query tabs, execute immediately when opened
  metadata?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class TabStateService {
  private readonly ipc = inject(IpcService);

  private readonly _tabs = signal<Tab[]>([
    {
      id: 'welcome',
      type: 'welcome',
      title: 'Welcome',
      icon: 'home',
    },
  ]);
  private readonly _activeTabId = signal<string>('welcome');

  // Public readonly signals
  readonly tabs = this._tabs.asReadonly();
  readonly activeTabId = this._activeTabId.asReadonly();

  // Computed
  readonly activeTab = computed(() => {
    const id = this._activeTabId();
    return this._tabs().find(t => t.id === id) ?? null;
  });

  readonly hasTabs = computed(() => this._tabs().length > 0);
  readonly tabCount = computed(() => this._tabs().length);

  // Observables
  readonly tabs$ = toObservable(this.tabs);
  readonly activeTab$ = toObservable(this.activeTab);

  private tabCounter = 0;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Schedule a debounced save of tabs
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTabs();
      this.saveTimeout = null;
    }, 500);
  }

  openTab(tab: Omit<Tab, 'id'>): string {
    const id = `tab-${++this.tabCounter}`;
    const newTab: Tab = { ...tab, id };
    this._tabs.update(tabs => [...tabs, newTab]);
    this._activeTabId.set(id);
    // Auto-save tabs
    this.saveTabs();
    return id;
  }

  closeTab(tabId: string): void {
    const tabs = this._tabs();
    const index = tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;

    // Don't allow closing welcome tab if it's the only tab
    if (tabs.length === 1 && tabs[0].type === 'welcome') {
      return;
    }

    this._tabs.update(currentTabs => currentTabs.filter(t => t.id !== tabId));

    // If closing active tab, activate another tab
    if (this._activeTabId() === tabId) {
      const newTabs = this._tabs();
      if (newTabs.length > 0) {
        // Prefer the tab to the left, or the first tab
        const newIndex = Math.min(index, newTabs.length - 1);
        this._activeTabId.set(newTabs[newIndex].id);
      }
    }
    // Auto-save tabs
    this.saveTabs();
  }

  activateTab(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      this._activeTabId.set(tabId);
    }
  }

  updateTab(tabId: string, updates: Partial<Tab>): void {
    this._tabs.update(tabs => tabs.map(t => (t.id === tabId ? { ...t, ...updates } : t)));
    // Debounced save for content updates
    if (updates.content !== undefined) {
      this.scheduleSave();
    }
  }

  setTabDirty(tabId: string, isDirty: boolean): void {
    this.updateTab(tabId, { isDirty });
  }

  setTabContent(tabId: string, content: string): void {
    this.updateTab(tabId, { content, isDirty: true });
  }

  /**
   * Toggle pin state for a tab
   */
  togglePin(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      this.updateTab(tabId, { isPinned: !tab.isPinned });
    }
  }

  /**
   * Pin a specific tab
   */
  pinTab(tabId: string): void {
    this.updateTab(tabId, { isPinned: true });
  }

  /**
   * Unpin a specific tab
   */
  unpinTab(tabId: string): void {
    this.updateTab(tabId, { isPinned: false });
  }

  openQueryTab(
    connectionId: string,
    databaseName: string,
    initialSql?: string,
    autoExecute = false
  ): string {
    const queryTabs = this._tabs().filter(t => t.type === 'query');
    const title = `Query ${queryTabs.length + 1}`;

    return this.openTab({
      type: 'query',
      title,
      icon: 'code',
      connectionId,
      databaseName,
      content: initialSql || '',
      isDirty: !!initialSql,
      autoExecute,
    });
  }

  clearAutoExecute(tabId: string): void {
    this.updateTab(tabId, { autoExecute: false });
  }

  openObjectTab(
    connectionId: string,
    databaseName: string,
    objectName: string,
    objectType: string
  ): string {
    // Check if tab already exists
    const existing = this._tabs().find(
      t =>
        t.type === 'object' &&
        t.connectionId === connectionId &&
        t.databaseName === databaseName &&
        t.metadata?.['objectName'] === objectName
    );

    if (existing) {
      this._activeTabId.set(existing.id);
      return existing.id;
    }

    return this.openTab({
      type: 'object',
      title: objectName,
      icon: this.getIconForObjectType(objectType),
      connectionId,
      databaseName,
      metadata: { objectName, objectType },
    });
  }

  /**
   * Open an ERD (Entity Relationship Diagram) tab
   * @param connectionId The connection ID
   * @param databaseName The database name
   * @param tableName Optional table name to focus on
   * @param schema Optional schema name (defaults to 'dbo')
   */
  openErdTab(
    connectionId: string,
    databaseName: string,
    tableName?: string,
    schema?: string
  ): string {
    // Check if ERD tab already exists for this database/table
    const existing = this._tabs().find(
      t =>
        t.type === 'erd' &&
        t.connectionId === connectionId &&
        t.databaseName === databaseName &&
        t.metadata?.['tableName'] === tableName
    );

    if (existing) {
      this._activeTabId.set(existing.id);
      return existing.id;
    }

    const title = tableName ? `ERD: ${tableName}` : `ERD: ${databaseName}`;

    return this.openTab({
      type: 'erd',
      title,
      icon: 'account_tree',
      connectionId,
      databaseName,
      metadata: {
        tableName,
        schema: schema || 'dbo',
        focusDepth: tableName ? 2 : undefined, // Show 2 levels of relationships when focused on a table
      },
    });
  }

  getDirtyTabs(): Tab[] {
    return this._tabs().filter(t => t.isDirty);
  }

  closeAllTabs(): void {
    this._tabs.set([
      {
        id: 'welcome',
        type: 'welcome',
        title: 'Welcome',
        icon: 'home',
      },
    ]);
    this._activeTabId.set('welcome');
  }

  closeOtherTabs(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      this._tabs.set([tab]);
      this._activeTabId.set(tabId);
    }
  }

  nextTab(): void {
    const tabs = this._tabs();
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex(t => t.id === this._activeTabId());
    const nextIndex = (currentIndex + 1) % tabs.length;
    this._activeTabId.set(tabs[nextIndex].id);
  }

  previousTab(): void {
    const tabs = this._tabs();
    if (tabs.length <= 1) return;

    const currentIndex = tabs.findIndex(t => t.id === this._activeTabId());
    const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    this._activeTabId.set(tabs[prevIndex].id);
  }

  private getIconForObjectType(objectType: string): string {
    const iconMap: Record<string, string> = {
      table: 'table_chart',
      view: 'view_list',
      procedure: 'functions',
      function: 'calculate',
      index: 'format_list_numbered',
      trigger: 'bolt',
      constraint: 'link',
    };
    return iconMap[objectType.toLowerCase()] || 'description';
  }

  /**
   * Save tabs to persistent storage
   */
  async saveTabs(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const tabs = this._tabs();
      // Only save query tabs (not results, objects, or welcome)
      const persistableTabs: TabState[] = tabs
        .filter(t => t.type === 'query')
        .map(t => ({
          id: t.id,
          type: t.type,
          title: t.title,
          content: t.content,
          databaseName: t.databaseName,
          isDirty: t.isDirty,
        }));

      await firstValueFrom(this.ipc.saveTabs(persistableTabs, this._activeTabId()));
    } catch (error) {
      console.error('Failed to save tabs:', error);
    }
  }

  /**
   * Restore tabs from persistent storage
   */
  async restoreTabs(connectionId: string): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const { tabs: savedTabs, activeTabId } = await firstValueFrom(this.ipc.getTabs());

      if (savedTabs.length === 0) return;

      // Convert saved tabs to full Tab objects
      const restoredTabs: Tab[] = savedTabs.map((t, index) => ({
        id: t.id || `restored-${index}`,
        type: t.type as TabType,
        title: t.title,
        icon: t.type === 'query' ? 'code' : 'description',
        connectionId,
        databaseName: t.databaseName,
        content: t.content,
        isDirty: t.isDirty,
      }));

      // Add welcome tab if not present
      const hasWelcome = this._tabs().some(t => t.type === 'welcome');
      if (hasWelcome) {
        const welcomeTab = this._tabs().find(t => t.type === 'welcome')!;
        this._tabs.set([welcomeTab, ...restoredTabs]);
      } else {
        this._tabs.update(tabs => [...tabs, ...restoredTabs]);
      }

      // Update tab counter based on restored tabs
      const maxTabNum = restoredTabs
        .map(t => parseInt(t.id.replace('tab-', ''), 10))
        .filter(n => !isNaN(n))
        .reduce((max, n) => Math.max(max, n), this.tabCounter);
      this.tabCounter = maxTabNum;

      // Restore active tab if it exists
      if (activeTabId && this._tabs().some(t => t.id === activeTabId)) {
        this._activeTabId.set(activeTabId);
      }
    } catch (error) {
      console.error('Failed to restore tabs:', error);
    }
  }
}
