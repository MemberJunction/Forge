import { Injectable, computed, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

export type TabType = 'query' | 'results' | 'object' | 'welcome';

export interface Tab {
  id: string;
  type: TabType;
  title: string;
  icon: string;
  connectionId?: string;
  databaseName?: string;
  content?: string; // For query tabs, the SQL content
  isDirty?: boolean;
  autoExecute?: boolean; // For query tabs, execute immediately when opened
  metadata?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class TabStateService {
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

  openTab(tab: Omit<Tab, 'id'>): string {
    const id = `tab-${++this.tabCounter}`;
    const newTab: Tab = { ...tab, id };
    this._tabs.update(tabs => [...tabs, newTab]);
    this._activeTabId.set(id);
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
  }

  activateTab(tabId: string): void {
    const tab = this._tabs().find(t => t.id === tabId);
    if (tab) {
      this._activeTabId.set(tabId);
    }
  }

  updateTab(tabId: string, updates: Partial<Tab>): void {
    this._tabs.update(tabs => tabs.map(t => (t.id === tabId ? { ...t, ...updates } : t)));
  }

  setTabDirty(tabId: string, isDirty: boolean): void {
    this.updateTab(tabId, { isDirty });
  }

  setTabContent(tabId: string, content: string): void {
    this.updateTab(tabId, { content, isDirty: true });
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
}
