/**
 * Application settings types
 */

export type ThemePreference = 'system' | 'light' | 'dark';

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  autoComplete: boolean;
}

export interface QuerySettings {
  defaultTimeout: number; // milliseconds
  maxRowsToDisplay: number;
  autoExecuteOnOpen: boolean;
  showExecutionTime: boolean;
  confirmBeforeExecute: boolean;
}

export interface GridSettings {
  rowHeight: number;
  showRowNumbers: boolean;
  alternatingRowColors: boolean;
  animateRows: boolean;
}

export interface AppSettings {
  theme: ThemePreference;
  editor: EditorSettings;
  query: QuerySettings;
  grid: GridSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  editor: {
    fontSize: 13,
    tabSize: 4,
    wordWrap: false,
    minimap: true,
    lineNumbers: true,
    autoComplete: true,
  },
  query: {
    defaultTimeout: 30000,
    maxRowsToDisplay: 10000,
    autoExecuteOnOpen: false,
    showExecutionTime: true,
    confirmBeforeExecute: false,
  },
  grid: {
    rowHeight: 24,
    showRowNumbers: true,
    alternatingRowColors: true,
    animateRows: false,
  },
};
