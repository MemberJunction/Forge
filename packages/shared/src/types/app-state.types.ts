/**
 * App State Types for persistence across sessions
 */

export interface TabState {
  id: string;
  type: 'query' | 'results' | 'object' | 'welcome';
  title: string;
  content?: string;
  databaseName?: string;
  isDirty?: boolean;
  filePath?: string; // For workspace files
}

export interface AppState {
  lastConnectionId: string | null;
  lastDatabase: string | null;
  editorHeightPercent: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  showQueryHistory: boolean;
  openTabs: TabState[];
  activeTabId: string | null;
  recentWorkspaces: string[];
  currentWorkspacePath: string | null;
}

export interface WorkspaceSettings {
  defaultConnection?: string;
  defaultDatabase?: string;
  executeOnOpen?: boolean;
  formatting?: {
    keywordCase?: 'upper' | 'lower' | 'preserve';
    indentSize?: number;
  };
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
  children?: FileTreeNode[];
}

export interface WorkspaceInfo {
  path: string;
  name: string;
  files: FileTreeNode[];
  settings?: WorkspaceSettings;
}
