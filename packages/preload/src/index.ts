import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type {
  ConnectionProfile,
  TestConnectionResult,
  DatabaseInfo,
  CreateDatabaseOptions,
  RenameDatabaseOptions,
  DeleteDatabaseOptions,
  DatabaseOperationResult,
  ObjectMetadata,
  ObjectType,
  QueryRequest,
  QueryResult,
  QueryHistoryEntry,
  QueryHistoryFilter,
  ExportOptions,
  ExportResult,
  ResultSet,
  BackupRequest,
  BackupProgress,
  RestoreRequest,
  RestoreProgress,
  DockerStatus,
  DockerContainer,
  DockerVolume,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
  ExtendedProperty,
  TableProperties,
} from '@mj-forge/shared';

/**
 * The API exposed to the renderer process via contextBridge
 */
export interface ForgeAPI {
  connection: {
    test: (profile: ConnectionProfile, password?: string) => Promise<TestConnectionResult>;
    save: (profile: ConnectionProfile, password?: string) => Promise<ConnectionProfile>;
    delete: (profileId: string) => Promise<void>;
    list: () => Promise<ConnectionProfile[]>;
    connect: (profileId: string) => Promise<void>;
    disconnect: (profileId: string) => Promise<void>;
  };

  docker: {
    detect: () => Promise<DockerStatus>;
    getContainers: () => Promise<DockerContainer[]>;
    getVolumes: () => Promise<DockerVolume[]>;
    startContainer: (containerId: string) => Promise<void>;
    stopContainer: (containerId: string) => Promise<void>;
  };

  database: {
    list: (connectionId: string) => Promise<DatabaseInfo[]>;
    create: (
      connectionId: string,
      options: CreateDatabaseOptions
    ) => Promise<DatabaseOperationResult>;
    rename: (
      connectionId: string,
      options: RenameDatabaseOptions
    ) => Promise<DatabaseOperationResult>;
    delete: (
      connectionId: string,
      options: DeleteDatabaseOptions
    ) => Promise<DatabaseOperationResult>;
    getInfo: (connectionId: string, databaseName: string) => Promise<DatabaseInfo>;
  };

  explorer: {
    getChildren: (
      connectionId: string,
      databaseName: string,
      parentPath: string
    ) => Promise<ObjectMetadata[]>;
    getObjectDetails: (
      connectionId: string,
      databaseName: string,
      objectType: ObjectType,
      objectName: string,
      schema?: string
    ) => Promise<ObjectMetadata>;
    refreshNode: (
      connectionId: string,
      databaseName: string,
      path: string
    ) => Promise<ObjectMetadata[]>;
    getTableColumns: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ColumnInfo[]>;
    getTableIndexes: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<IndexInfo[]>;
    getTableKeys: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ForeignKeyInfo[]>;
    getTableConstraints: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ConstraintInfo[]>;
    getTableTriggers: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<TriggerInfo[]>;
    getTableProperties: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<TableProperties>;
    getExtendedProperties: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ExtendedProperty[]>;
    scriptTableAsCreate: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<string>;
    scriptTableAsInsert: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<string>;
  };

  query: {
    execute: (request: QueryRequest) => Promise<QueryResult>;
    cancel: (queryId: string) => Promise<void>;
    getHistory: (filter?: QueryHistoryFilter) => Promise<QueryHistoryEntry[]>;
    clearHistory: () => Promise<void>;
    deleteHistoryEntry: (id: string) => Promise<boolean>;
    exportResults: (resultSet: ResultSet, options: ExportOptions) => Promise<ExportResult>;
  };

  backup: {
    start: (request: BackupRequest) => Promise<void>;
    cancel: (backupId: string) => Promise<void>;
    onProgress: (callback: (progress: BackupProgress) => void) => () => void;
  };

  restore: {
    start: (request: RestoreRequest) => Promise<void>;
    cancel: (restoreId: string) => Promise<void>;
    getFileList: (
      connectionId: string,
      backupPath: string
    ) => Promise<{ logicalName: string; physicalName: string; type: string }[]>;
    onProgress: (callback: (progress: RestoreProgress) => void) => () => void;
  };

  app: {
    getVersion: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
    showOpenDialog: (
      options: Electron.OpenDialogOptions
    ) => Promise<Electron.OpenDialogReturnValue>;
    showSaveDialog: (
      options: Electron.SaveDialogOptions
    ) => Promise<Electron.SaveDialogReturnValue>;
  };

  menu: {
    // File menu
    onNewConnection: (callback: () => void) => () => void;
    onNewQuery: (callback: () => void) => () => void;
    onOpenQuery: (callback: () => void) => () => void;
    onCloseTab: (callback: () => void) => () => void;
    onSaveQuery: (callback: () => void) => () => void;
    onSaveQueryAs: (callback: () => void) => () => void;
    onExportResults: (callback: () => void) => () => void;

    // Edit menu
    onFind: (callback: () => void) => () => void;
    onReplace: (callback: () => void) => () => void;
    onFormatSql: (callback: () => void) => () => void;
    onToggleComment: (callback: () => void) => () => void;

    // Query menu
    onExecuteQuery: (callback: () => void) => () => void;
    onExecuteSelection: (callback: () => void) => () => void;
    onCancelQuery: (callback: () => void) => () => void;
    onQueryHistory: (callback: () => void) => () => void;

    // Server menu
    onDisconnect: (callback: () => void) => () => void;
    onRefresh: (callback: () => void) => () => void;
    onServerProperties: (callback: () => void) => () => void;

    // Database menu
    onNewDatabase: (callback: () => void) => () => void;
    onBackup: (callback: () => void) => () => void;
    onRestore: (callback: () => void) => () => void;
    onDatabaseProperties: (callback: () => void) => () => void;

    // View menu
    onToggleSidebar: (callback: () => void) => () => void;
    onToggleResults: (callback: () => void) => () => void;

    // Window menu
    onNextTab: (callback: () => void) => () => void;
    onPreviousTab: (callback: () => void) => () => void;

    // Settings/Help
    onOpenSettings: (callback: () => void) => () => void;
    onShowShortcuts: (callback: () => void) => () => void;
  };
}

// Helper to create event listener cleanup functions
function createEventListener<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, data: T) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// Menu event channels
const MENU_CHANNELS = {
  // File menu
  NEW_CONNECTION: 'menu:new-connection',
  NEW_QUERY: 'menu:new-query',
  OPEN_QUERY: 'menu:open-query',
  CLOSE_TAB: 'menu:close-tab',
  SAVE_QUERY: 'menu:save-query',
  SAVE_QUERY_AS: 'menu:save-query-as',
  EXPORT_RESULTS: 'menu:export-results',

  // Edit menu
  FIND: 'menu:find',
  REPLACE: 'menu:replace',
  FORMAT_SQL: 'menu:format-sql',
  TOGGLE_COMMENT: 'menu:toggle-comment',

  // Query menu
  EXECUTE_QUERY: 'menu:execute-query',
  EXECUTE_SELECTION: 'menu:execute-selection',
  CANCEL_QUERY: 'menu:cancel-query',
  QUERY_HISTORY: 'menu:query-history',

  // Server menu
  DISCONNECT: 'menu:disconnect',
  REFRESH: 'menu:refresh',
  SERVER_PROPERTIES: 'menu:server-properties',

  // Database menu
  NEW_DATABASE: 'menu:new-database',
  BACKUP: 'menu:backup',
  RESTORE: 'menu:restore',
  DATABASE_PROPERTIES: 'menu:database-properties',

  // View menu
  TOGGLE_SIDEBAR: 'menu:toggle-sidebar',
  TOGGLE_RESULTS: 'menu:toggle-results',

  // Window menu
  NEXT_TAB: 'menu:next-tab',
  PREVIOUS_TAB: 'menu:previous-tab',

  // Settings/Help
  OPEN_SETTINGS: 'menu:open-settings',
  SHOW_SHORTCUTS: 'menu:show-shortcuts',
} as const;

// Create the API implementation
const forgeAPI: ForgeAPI = {
  connection: {
    test: (profile, password) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.TEST, profile, password),
    save: (profile, password) =>
      ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.SAVE, profile, password),
    delete: profileId => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.DELETE, profileId),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.LIST),
    connect: profileId => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.CONNECT, profileId),
    disconnect: profileId => ipcRenderer.invoke(IPC_CHANNELS.CONNECTION.DISCONNECT, profileId),
  },

  docker: {
    detect: () => ipcRenderer.invoke(IPC_CHANNELS.DOCKER.DETECT),
    getContainers: () => ipcRenderer.invoke(IPC_CHANNELS.DOCKER.GET_CONTAINERS),
    getVolumes: () => ipcRenderer.invoke(IPC_CHANNELS.DOCKER.GET_VOLUMES),
    startContainer: containerId =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCKER.START_CONTAINER, containerId),
    stopContainer: containerId =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCKER.STOP_CONTAINER, containerId),
  },

  database: {
    list: connectionId => ipcRenderer.invoke(IPC_CHANNELS.DATABASE.LIST, connectionId),
    create: (connectionId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.CREATE, connectionId, options),
    rename: (connectionId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.RENAME, connectionId, options),
    delete: (connectionId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.DELETE, connectionId, options),
    getInfo: (connectionId, databaseName) =>
      ipcRenderer.invoke(IPC_CHANNELS.DATABASE.GET_INFO, connectionId, databaseName),
  },

  explorer: {
    getChildren: (connectionId, databaseName, parentPath) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_CHILDREN,
        connectionId,
        databaseName,
        parentPath
      ),
    getObjectDetails: (connectionId, databaseName, objectType, objectName, schema) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_OBJECT_DETAILS,
        connectionId,
        databaseName,
        objectType,
        objectName,
        schema
      ),
    refreshNode: (connectionId, databaseName, path) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPLORER.REFRESH_NODE, connectionId, databaseName, path),
    getTableColumns: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_TABLE_COLUMNS,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    getTableIndexes: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_TABLE_INDEXES,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    getTableKeys: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_TABLE_KEYS,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    getTableConstraints: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_TABLE_CONSTRAINTS,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    getTableTriggers: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_TABLE_TRIGGERS,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    getTableProperties: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_TABLE_PROPERTIES,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    getExtendedProperties: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_EXTENDED_PROPERTIES,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    scriptTableAsCreate: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.SCRIPT_TABLE_CREATE,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
    scriptTableAsInsert: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.SCRIPT_TABLE_INSERT,
        connectionId,
        databaseName,
        schema,
        tableName
      ),
  },

  query: {
    execute: request => ipcRenderer.invoke(IPC_CHANNELS.QUERY.EXECUTE, request),
    cancel: queryId => ipcRenderer.invoke(IPC_CHANNELS.QUERY.CANCEL, queryId),
    getHistory: filter => ipcRenderer.invoke(IPC_CHANNELS.QUERY.GET_HISTORY, filter),
    clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.QUERY.CLEAR_HISTORY),
    deleteHistoryEntry: id => ipcRenderer.invoke(IPC_CHANNELS.QUERY.DELETE_HISTORY_ENTRY, id),
    exportResults: (resultSet, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.QUERY.EXPORT_RESULTS, resultSet, options),
  },

  backup: {
    start: request => ipcRenderer.invoke(IPC_CHANNELS.BACKUP.START, request),
    cancel: backupId => ipcRenderer.invoke(IPC_CHANNELS.BACKUP.CANCEL, backupId),
    onProgress: callback => createEventListener(IPC_CHANNELS.BACKUP.PROGRESS, callback),
  },

  restore: {
    start: request => ipcRenderer.invoke(IPC_CHANNELS.RESTORE.START, request),
    cancel: restoreId => ipcRenderer.invoke(IPC_CHANNELS.RESTORE.CANCEL, restoreId),
    getFileList: (connectionId, backupPath) =>
      ipcRenderer.invoke(IPC_CHANNELS.RESTORE.GET_FILE_LIST, connectionId, backupPath),
    onProgress: callback => createEventListener(IPC_CHANNELS.RESTORE.PROGRESS, callback),
  },

  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP.GET_VERSION),
    openExternal: url => ipcRenderer.invoke(IPC_CHANNELS.APP.OPEN_EXTERNAL, url),
    showOpenDialog: options => ipcRenderer.invoke(IPC_CHANNELS.APP.SHOW_OPEN_DIALOG, options),
    showSaveDialog: options => ipcRenderer.invoke(IPC_CHANNELS.APP.SHOW_SAVE_DIALOG, options),
  },

  menu: {
    // File menu
    onNewConnection: callback => createEventListener(MENU_CHANNELS.NEW_CONNECTION, callback),
    onNewQuery: callback => createEventListener(MENU_CHANNELS.NEW_QUERY, callback),
    onOpenQuery: callback => createEventListener(MENU_CHANNELS.OPEN_QUERY, callback),
    onCloseTab: callback => createEventListener(MENU_CHANNELS.CLOSE_TAB, callback),
    onSaveQuery: callback => createEventListener(MENU_CHANNELS.SAVE_QUERY, callback),
    onSaveQueryAs: callback => createEventListener(MENU_CHANNELS.SAVE_QUERY_AS, callback),
    onExportResults: callback => createEventListener(MENU_CHANNELS.EXPORT_RESULTS, callback),

    // Edit menu
    onFind: callback => createEventListener(MENU_CHANNELS.FIND, callback),
    onReplace: callback => createEventListener(MENU_CHANNELS.REPLACE, callback),
    onFormatSql: callback => createEventListener(MENU_CHANNELS.FORMAT_SQL, callback),
    onToggleComment: callback => createEventListener(MENU_CHANNELS.TOGGLE_COMMENT, callback),

    // Query menu
    onExecuteQuery: callback => createEventListener(MENU_CHANNELS.EXECUTE_QUERY, callback),
    onExecuteSelection: callback => createEventListener(MENU_CHANNELS.EXECUTE_SELECTION, callback),
    onCancelQuery: callback => createEventListener(MENU_CHANNELS.CANCEL_QUERY, callback),
    onQueryHistory: callback => createEventListener(MENU_CHANNELS.QUERY_HISTORY, callback),

    // Server menu
    onDisconnect: callback => createEventListener(MENU_CHANNELS.DISCONNECT, callback),
    onRefresh: callback => createEventListener(MENU_CHANNELS.REFRESH, callback),
    onServerProperties: callback => createEventListener(MENU_CHANNELS.SERVER_PROPERTIES, callback),

    // Database menu
    onNewDatabase: callback => createEventListener(MENU_CHANNELS.NEW_DATABASE, callback),
    onBackup: callback => createEventListener(MENU_CHANNELS.BACKUP, callback),
    onRestore: callback => createEventListener(MENU_CHANNELS.RESTORE, callback),
    onDatabaseProperties: callback =>
      createEventListener(MENU_CHANNELS.DATABASE_PROPERTIES, callback),

    // View menu
    onToggleSidebar: callback => createEventListener(MENU_CHANNELS.TOGGLE_SIDEBAR, callback),
    onToggleResults: callback => createEventListener(MENU_CHANNELS.TOGGLE_RESULTS, callback),

    // Window menu
    onNextTab: callback => createEventListener(MENU_CHANNELS.NEXT_TAB, callback),
    onPreviousTab: callback => createEventListener(MENU_CHANNELS.PREVIOUS_TAB, callback),

    // Settings/Help
    onOpenSettings: callback => createEventListener(MENU_CHANNELS.OPEN_SETTINGS, callback),
    onShowShortcuts: callback => createEventListener(MENU_CHANNELS.SHOW_SHORTCUTS, callback),
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('forge', forgeAPI);

// Type declaration for renderer
declare global {
  interface Window {
    forge: ForgeAPI;
  }
}
