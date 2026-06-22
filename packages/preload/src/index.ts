import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS, CHAT_IPC_CHANNELS } from '@mj-forge/shared';
import type {
  ConnectionProfile,
  TestConnectionResult,
  DatabaseInfo,
  SchemaInfo,
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
  FkRecordRequest,
  FkRecordResult,
  BackupRequest,
  BackupProgress,
  BackupFileInfo,
  BackupHistoryEntry,
  CliDepsResult,
  CliEngine,
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
  ObjectDefinition,
  AppState,
  TabState,
  FileTreeNode,
  WorkspaceInfo,
  LayoutConfig,
  // Query Results types
  QueryResultSnapshot,
  QueryResultHistoryFilter,
  ResultHistorySortOptions,
  PurgeOptions,
  PurgeResult,
  ResultStorageStats,
  ResultDiff,
  DiffOptions,
  // AI types
  AIVendor,
  AISettings,
  TabRenameRequest,
  TabRenameResponse,
  AnalysisRequest,
  AnalysisResponse,
  SQLGenerationRequest,
  SQLGenerationResponse,
  // Chat types
  ChatRequest,
  ChatStreamChunk,
  Conversation,
  ToolDefinition,
  // Server file system types
  ServerDrive,
  ServerFileEntry,
  ServerDefaultPaths,
  // MemberJunction types
  MJDatabaseInfo,
  MJEntityInfo,
  MJEntityFieldInfo,
  MJApplicationInfo,
  MJRecordChange,
  MJAuditLog,
  MJQuery,
  MJErrorLog,
  MJUserRecordLog,
  MJEntityRelationship,
  LogEntry,
  // MJ Dev Manager instance types
  InstanceRecord,
  InstanceConfig,
  InstanceEvent,
  ManagedProcess,
  SetupStep,
  DevPersona,
  AppAccessEntry,
} from '@mj-forge/shared';

/**
 * The API exposed to the renderer process via contextBridge
 */
export interface ForgeAPI {
  connection: {
    test: (
      profile: ConnectionProfile,
      password?: string,
      sshPassword?: string,
      sshPassphrase?: string
    ) => Promise<TestConnectionResult>;
    save: (
      profile: ConnectionProfile,
      password?: string,
      sshPassword?: string,
      sshPassphrase?: string
    ) => Promise<ConnectionProfile>;
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
    createContainer: (options: {
      name: string;
      password: string;
      port: number;
      image?: string;
      acceptEula?: boolean;
    }) => Promise<{ success: boolean; containerId?: string; error?: string }>;
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
    listSchemas: (connectionId: string, databaseName: string) => Promise<SchemaInfo[]>;
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
    getDefinition: (
      connectionId: string,
      databaseName: string,
      schema: string,
      name: string,
      objectType: string
    ) => Promise<ObjectDefinition>;
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
    getEnrichedColumns: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<
      Array<{
        name: string;
        type: string;
        nullable: boolean;
        maxLength: number | null;
        precision: number | null;
        scale: number | null;
        isPrimaryKey: boolean;
        isIdentity: boolean;
        defaultValue: string | null;
        foreignKey: {
          referencedSchema: string;
          referencedTable: string;
          referencedColumn: string;
          constraintName: string;
        } | null;
      }>
    >;
  };

  query: {
    execute: (request: QueryRequest) => Promise<QueryResult>;
    cancel: (queryId: string) => Promise<void>;
    getHistory: (filter?: QueryHistoryFilter) => Promise<QueryHistoryEntry[]>;
    clearHistory: () => Promise<void>;
    deleteHistoryEntry: (id: string) => Promise<boolean>;
    exportResults: (resultSet: ResultSet, options: ExportOptions) => Promise<ExportResult>;
    fetchFkRecord: (request: FkRecordRequest) => Promise<FkRecordResult>;
    convertSql: (
      sql: string,
      fromEngine: string,
      toEngine: string
    ) => Promise<{ success: boolean; sql: string; error?: string }>;
  };

  queryResults: {
    saveSnapshot: (
      tabId: string,
      sql: string,
      connectionId: string,
      database: string,
      result: QueryResult
    ) => Promise<QueryResultSnapshot>;
    getSnapshots: (
      filter?: QueryResultHistoryFilter,
      sort?: ResultHistorySortOptions
    ) => Promise<QueryResultSnapshot[]>;
    getSnapshot: (id: string) => Promise<QueryResultSnapshot | null>;
    deleteSnapshot: (id: string) => Promise<boolean>;
    deleteSnapshots: (ids: string[]) => Promise<number>;
    pinSnapshot: (id: string) => Promise<boolean>;
    unpinSnapshot: (id: string) => Promise<boolean>;
    labelSnapshot: (id: string, label: string) => Promise<boolean>;
    getStorageStats: () => Promise<ResultStorageStats>;
    purge: (options: PurgeOptions) => Promise<PurgeResult>;
    compareSnapshots: (
      baseId: string,
      compareId: string,
      options?: DiffOptions
    ) => Promise<ResultDiff | null>;
  };

  ai: {
    getVendors: () => Promise<AIVendor[]>;
    getSettings: () => Promise<AISettings>;
    setSettings: (settings: Partial<AISettings>) => Promise<AISettings>;
    setApiKey: (vendorId: string, apiKey: string) => Promise<boolean>;
    removeApiKey: (vendorId: string) => Promise<boolean>;
    validateApiKey: (vendorId: string, apiKey: string) => Promise<boolean>;
    generateTabName: (request: TabRenameRequest) => Promise<TabRenameResponse>;
    analyzeResults: (request: AnalysisRequest) => Promise<AnalysisResponse>;
    generateSQL: (request: SQLGenerationRequest) => Promise<SQLGenerationResponse>;
    cancelRequest: (requestId: string) => Promise<boolean>;
  };

  chat: {
    getTools: () => Promise<ToolDefinition[]>;
    listConversations: () => Promise<Conversation[]>;
    getConversation: (id: string) => Promise<Conversation | null>;
    createConversation: (title?: string) => Promise<Conversation>;
    deleteConversation: (id: string) => Promise<boolean>;
    renameConversation: (id: string, title: string) => Promise<Conversation | null>;
    sendMessage: (request: ChatRequest) => Promise<{ started: boolean }>;
    confirmTool: (
      conversationId: string,
      toolCallId: string,
      confirmed: boolean
    ) => Promise<{ confirmed: boolean }>;
    cancelStream: (conversationId: string) => Promise<{ cancelled: boolean }>;
    onStreamChunk: (callback: (chunk: ChatStreamChunk) => void) => () => void;
  };

  serverFs: {
    getDrives: (connectionId: string) => Promise<ServerDrive[]>;
    listDirectory: (
      connectionId: string,
      path: string,
      includeFiles?: boolean
    ) => Promise<ServerFileEntry[]>;
    getDefaultPaths: (connectionId: string) => Promise<ServerDefaultPaths>;
  };

  backup: {
    start: (request: BackupRequest) => Promise<void>;
    cancel: (backupId: string) => Promise<void>;
    getHistory: (connectionId: string, databaseName?: string) => Promise<BackupHistoryEntry[]>;
    onProgress: (callback: (progress: BackupProgress) => void) => () => void;
    checkTools: (engine: CliEngine) => Promise<CliDepsResult>;
    recheckTools: (engine: CliEngine) => Promise<CliDepsResult>;
  };

  restore: {
    start: (request: RestoreRequest) => Promise<void>;
    cancel: (restoreId: string) => Promise<void>;
    getFileList: (
      connectionId: string,
      backupPath: string
    ) => Promise<{ logicalName: string; physicalName: string; type: string }[]>;
    getBackupInfo: (connectionId: string, backupPath: string) => Promise<BackupFileInfo>;
    onProgress: (callback: (progress: RestoreProgress) => void) => () => void;
  };

  logs: {
    getRecent: (limit?: number) => Promise<LogEntry[]>;
    append: (entry: LogEntry) => Promise<void>;
    onEntry: (callback: (entry: LogEntry) => void) => () => void;
    revealFile: () => Promise<string>;
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
    // State persistence
    getState: () => Promise<AppState>;
    setState: (partial: Partial<AppState>) => Promise<void>;
    saveTabs: (tabs: TabState[], activeTabId: string | null) => Promise<void>;
    getTabs: () => Promise<{ tabs: TabState[]; activeTabId: string | null }>;
    // GoldenLayout persistence
    saveLayout: (config: LayoutConfig | undefined) => Promise<void>;
    getLayout: () => Promise<LayoutConfig | undefined>;
    // Atomic save-dialog + file write (main process shows dialog and writes)
    saveToFile: (
      options: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      },
      content: string
    ) => Promise<{ canceled: boolean; filePath?: string }>;
  };

  workspace: {
    openFolder: (path: string) => Promise<WorkspaceInfo>;
    getFiles: (path: string) => Promise<FileTreeNode[]>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<void>;
    createFile: (filePath: string, content?: string) => Promise<void>;
    deleteFile: (filePath: string) => Promise<void>;
    renameFile: (oldPath: string, newPath: string) => Promise<void>;
    onFileChanged: (callback: (event: { filePath: string; type: string }) => void) => () => void;
  };

  // MemberJunction Integration
  mj: {
    detect: (
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ) => Promise<MJDatabaseInfo>;
    getEntities: (
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ) => Promise<MJEntityInfo[]>;
    getEntityFields: (
      connectionId: string,
      database: string,
      entityId: string,
      mjSchemaName?: string
    ) => Promise<MJEntityFieldInfo[]>;
    getApplications: (
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ) => Promise<MJApplicationInfo[]>;
    getEntityRelationships: (
      connectionId: string,
      database: string,
      entityId?: string,
      mjSchemaName?: string
    ) => Promise<MJEntityRelationship[]>;
    getRecordChanges: (
      connectionId: string,
      database: string,
      options?: { entityId?: string; entityName?: string; recordId?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJRecordChange[]>;
    getAuditLogs: (
      connectionId: string,
      database: string,
      options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJAuditLog[]>;
    getSavedQueries: (
      connectionId: string,
      database: string,
      categoryId?: string,
      mjSchemaName?: string
    ) => Promise<MJQuery[]>;
    getErrorLogs: (
      connectionId: string,
      database: string,
      options?: { category?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJErrorLog[]>;
    getUserRecordLogs: (
      connectionId: string,
      database: string,
      options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJUserRecordLog[]>;
  };

  theme: {
    getNative: () => Promise<'dark' | 'light'>;
    onChanged: (callback: (theme: 'dark' | 'light') => void) => () => void;
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
    onCopy: (callback: () => void) => () => void;
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
    onShowWelcome: (callback: () => void) => () => void;
    onToggleSidebar: (callback: () => void) => () => void;
    onToggleChat: (callback: () => void) => () => void;
    onToggleResults: (callback: () => void) => () => void;

    // Window menu
    onNextTab: (callback: () => void) => () => void;
    onPreviousTab: (callback: () => void) => () => void;

    // Settings/Help
    onOpenSettings: (callback: () => void) => () => void;
    onShowShortcuts: (callback: () => void) => () => void;
  };

  // MJ Dev Manager — instance orchestration
  instances: {
    create: (config: InstanceConfig) => Promise<InstanceRecord>;
    list: () => Promise<InstanceRecord[]>;
    info: (
      slug: string
    ) => Promise<{ record: InstanceRecord; containerState?: string; processes: ManagedProcess[] }>;
    start: (slug: string) => Promise<InstanceRecord>;
    stop: (slug: string) => Promise<InstanceRecord>;
    delete: (slug: string) => Promise<{ success: boolean }>;
    openInVSCode: (slug: string) => Promise<{ success: boolean; path: string }>;
    runSetup: (slug: string, step: SetupStep | 'all') => Promise<InstanceRecord>;
    startProcess: (
      slug: string,
      target: 'api' | 'explorer' | { script: string }
    ) => Promise<ManagedProcess>;
    stopProcess: (processId: string) => Promise<{ success: boolean }>;
    restartProcess: (processId: string) => Promise<ManagedProcess>;
    removeProcess: (processId: string) => Promise<{ success: boolean }>;
    listProcesses: (slug?: string) => Promise<{ processes: ManagedProcess[]; scripts: string[] }>;
    /** Incrementally tail a process's captured output from a byte offset. */
    processLogsSince: (
      processId: string,
      sinceByte: number
    ) => Promise<{ lines: string[]; nextByte: number }>;
    /** Subscribe to streamed progress/log events; returns an unsubscribe fn. */
    onEvent: (callback: (event: InstanceEvent) => void) => () => void;
  };

  /** MJ Dev Manager — developer identity / persona auth (Phase 2). */
  identity: {
    listPersonas: () => Promise<DevPersona[]>;
    savePersona: (persona: DevPersona) => Promise<DevPersona>;
    deletePersona: (id: string) => Promise<{ success: boolean }>;
    getActive: () => Promise<DevPersona | undefined>;
    setActive: (id: string) => Promise<{ success: boolean }>;
    setInstancePersona: (slug: string, personaId: string | undefined) => Promise<InstanceRecord>;
    whoami: (slug: string) => Promise<DevPersona>;
    mintKey: (slug: string, force?: boolean) => Promise<{ rawKey: string }>;
    openExplorer: (slug: string) => Promise<{ success: boolean; url: string }>;
    listAppAccess: (slug: string) => Promise<AppAccessEntry[]>;
    setAppAccess: (slug: string, appName: string, granted: boolean) => Promise<AppAccessEntry[]>;
  };

  /** MJ Dev Manager — Open App dev-linking (Phase B). */
  openApps: {
    link: (
      slug: string,
      appRef: string,
      opts?: {
        ignoreVersionRange?: boolean;
        allowDoubleUnderscore?: boolean;
        appBranch?: string;
        baseRef?: string;
      }
    ) => Promise<{ appName: string; snapshot: unknown }>;
    install: (
      slug: string,
      source: string,
      opts?: { version?: string; allowDoubleUnderscore?: boolean }
    ) => Promise<{ appName: string; version: string }>;
    resolveDeps: (
      slug: string,
      appRef: string
    ) => Promise<{
      appName: string;
      dependencies: Array<{
        name: string;
        versionRange: string;
        repository?: string;
        present: boolean;
      }>;
    }>;
    recents: () => Promise<string[]>;
    remove: (
      slug: string,
      appName: string,
      opts?: { keepData?: boolean; force?: boolean }
    ) => Promise<{ success: boolean }>;
    unlink: (
      slug: string,
      appName: string,
      opts?: { dropSchema?: boolean }
    ) => Promise<{ success: boolean }>;
    switchMode: (
      slug: string,
      appName: string,
      target: 'dev' | 'installed'
    ) => Promise<{ success: boolean }>;
    list: (slug: string) => Promise<
      Array<{
        appName: string;
        mode: string;
        appRef: string;
        ignoreVersionRangeUsed: boolean;
        linkedBranch?: string;
      }>
    >;
    drift: (slug: string, appName: string) => Promise<{ valid: boolean; errors: string[] }>;
    resetSchema: (slug: string, appName: string) => Promise<{ success: boolean }>;
    repairSchema: (slug: string, appName: string) => Promise<{ success: boolean }>;
    build: (
      slug: string,
      appName: string
    ) => Promise<{ ok: boolean; built: string[]; failed: Array<{ name: string; error: string }> }>;
    buildAll: (slug: string) => Promise<{
      ok: boolean;
      apps: Array<{
        appName: string;
        ok: boolean;
        built: string[];
        failed: Array<{ name: string; error: string }>;
      }>;
    }>;
    migrate: (slug: string, appName: string) => Promise<{ ok: boolean; error?: string }>;
    codegen: (slug: string, appName: string) => Promise<{ ok: boolean; error?: string }>;
    sync: (
      slug: string,
      appName: string,
      opts?: { dir?: string; include?: string; mode?: 'push' | 'pull' | 'status' }
    ) => Promise<{ ok: boolean; error?: string }>;
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
  COPY: 'menu:copy',
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
  SHOW_WELCOME: 'menu:show-welcome',
  TOGGLE_SIDEBAR: 'menu:toggle-sidebar',
  TOGGLE_CHAT: 'menu:toggle-chat',
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
    test: (profile, password, sshPassword, sshPassphrase) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.CONNECTION.TEST,
        profile,
        password,
        sshPassword,
        sshPassphrase
      ),
    save: (profile, password, sshPassword, sshPassphrase) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.CONNECTION.SAVE,
        profile,
        password,
        sshPassword,
        sshPassphrase
      ),
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
    createContainer: options => ipcRenderer.invoke(IPC_CHANNELS.DOCKER.CREATE_CONTAINER, options),
  },

  instances: {
    create: config => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.CREATE, config),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.LIST),
    info: slug => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.INFO, slug),
    start: slug => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.START, slug),
    stop: slug => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.STOP, slug),
    delete: slug => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.DELETE, slug),
    openInVSCode: slug => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.OPEN_VSCODE, slug),
    runSetup: (slug, step) => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.SETUP_RUN, slug, step),
    startProcess: (slug, target) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.PROC_START, slug, target),
    stopProcess: processId => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.PROC_STOP, processId),
    restartProcess: processId => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.PROC_RESTART, processId),
    removeProcess: processId => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.PROC_REMOVE, processId),
    listProcesses: slug => ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.PROC_LIST, slug),
    processLogsSince: (processId, sinceByte) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSTANCES.PROC_LOGS, processId, sinceByte),
    onEvent: callback => createEventListener(IPC_CHANNELS.INSTANCES.EVENTS, callback),
  },

  identity: {
    listPersonas: () => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.PERSONA_LIST),
    savePersona: persona => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.PERSONA_SAVE, persona),
    deletePersona: id => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.PERSONA_DELETE, id),
    getActive: () => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.ACTIVE_GET),
    setActive: id => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.ACTIVE_SET, id),
    setInstancePersona: (slug, personaId) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.INSTANCE_PERSONA_SET, slug, personaId),
    whoami: slug => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.WHOAMI, slug),
    mintKey: (slug, force) => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.MINT_KEY, slug, force),
    openExplorer: slug => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.OPEN_EXPLORER, slug),
    listAppAccess: slug => ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.APP_ACCESS_LIST, slug),
    setAppAccess: (slug, appName, granted) =>
      ipcRenderer.invoke(IPC_CHANNELS.IDENTITY.APP_ACCESS_SET, slug, appName, granted),
  },

  openApps: {
    link: (slug, appRef, opts) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.LINK, slug, appRef, opts),
    install: (slug, source, opts) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.INSTALL, slug, source, opts),
    resolveDeps: (slug, appRef) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.RESOLVE_DEPS, slug, appRef),
    recents: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.RECENTS),
    remove: (slug, appName, opts) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.REMOVE, slug, appName, opts),
    unlink: (slug, appName, opts) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.UNLINK, slug, appName, opts),
    switchMode: (slug, appName, target) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.SWITCH_MODE, slug, appName, target),
    list: slug => ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.LIST, slug),
    drift: (slug, appName) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.DRIFT, slug, appName),
    resetSchema: (slug, appName) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.RESET_SCHEMA, slug, appName),
    repairSchema: (slug, appName) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.REPAIR_SCHEMA, slug, appName),
    build: (slug, appName) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.BUILD, slug, appName),
    buildAll: slug => ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.BUILD_ALL, slug),
    migrate: (slug, appName) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.MIGRATE, slug, appName),
    codegen: (slug, appName) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.CODEGEN, slug, appName),
    sync: (slug, appName, opts) =>
      ipcRenderer.invoke(IPC_CHANNELS.OPEN_APPS.SYNC, slug, appName, opts),
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
    listSchemas: (connectionId, databaseName) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPLORER.LIST_SCHEMAS, connectionId, databaseName),
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
    getDefinition: (connectionId, databaseName, schema, name, objectType) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_DEFINITION,
        connectionId,
        databaseName,
        schema,
        name,
        objectType
      ),
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
    getEnrichedColumns: (connectionId, databaseName, schema, tableName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.EXPLORER.GET_ENRICHED_COLUMNS,
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
    fetchFkRecord: request => ipcRenderer.invoke(IPC_CHANNELS.QUERY.FETCH_FK_RECORD, request),
    convertSql: (sql: string, fromEngine: string, toEngine: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.QUERY.CONVERT_SQL, sql, fromEngine, toEngine),
  },

  queryResults: {
    saveSnapshot: (tabId, sql, connectionId, database, result) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.QUERY_RESULTS.SAVE_SNAPSHOT,
        tabId,
        sql,
        connectionId,
        database,
        result
      ),
    getSnapshots: (filter, sort) =>
      ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.GET_SNAPSHOTS, filter, sort),
    getSnapshot: id => ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.GET_SNAPSHOT, id),
    deleteSnapshot: id => ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.DELETE_SNAPSHOT, id),
    deleteSnapshots: ids => ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.DELETE_SNAPSHOTS, ids),
    pinSnapshot: id => ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.PIN_SNAPSHOT, id),
    unpinSnapshot: id => ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.UNPIN_SNAPSHOT, id),
    labelSnapshot: (id, label) =>
      ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.LABEL_SNAPSHOT, id, label),
    getStorageStats: () => ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.GET_STORAGE_STATS),
    purge: options => ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.PURGE, options),
    compareSnapshots: (baseId, compareId, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.QUERY_RESULTS.COMPARE_SNAPSHOTS, baseId, compareId, options),
  },

  ai: {
    getVendors: () => ipcRenderer.invoke(IPC_CHANNELS.AI.GET_VENDORS),
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.AI.GET_SETTINGS),
    setSettings: settings => ipcRenderer.invoke(IPC_CHANNELS.AI.SET_SETTINGS, settings),
    setApiKey: (vendorId, apiKey) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI.SET_API_KEY, vendorId, apiKey),
    removeApiKey: vendorId => ipcRenderer.invoke(IPC_CHANNELS.AI.REMOVE_API_KEY, vendorId),
    validateApiKey: (vendorId, apiKey) =>
      ipcRenderer.invoke(IPC_CHANNELS.AI.VALIDATE_API_KEY, vendorId, apiKey),
    generateTabName: request => ipcRenderer.invoke(IPC_CHANNELS.AI.GENERATE_TAB_NAME, request),
    analyzeResults: request => ipcRenderer.invoke(IPC_CHANNELS.AI.ANALYZE_RESULTS, request),
    generateSQL: request => ipcRenderer.invoke(IPC_CHANNELS.AI.GENERATE_SQL, request),
    cancelRequest: requestId => ipcRenderer.invoke(IPC_CHANNELS.AI.CANCEL_REQUEST, requestId),
  },

  chat: {
    getTools: () => ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_TOOLS),
    listConversations: () => ipcRenderer.invoke(CHAT_IPC_CHANNELS.LIST_CONVERSATIONS),
    getConversation: id => ipcRenderer.invoke(CHAT_IPC_CHANNELS.GET_CONVERSATION, id),
    createConversation: title => ipcRenderer.invoke(CHAT_IPC_CHANNELS.CREATE_CONVERSATION, title),
    deleteConversation: id => ipcRenderer.invoke(CHAT_IPC_CHANNELS.DELETE_CONVERSATION, id),
    renameConversation: (id, title) =>
      ipcRenderer.invoke(CHAT_IPC_CHANNELS.RENAME_CONVERSATION, id, title),
    sendMessage: request => ipcRenderer.invoke(CHAT_IPC_CHANNELS.SEND_MESSAGE, request),
    confirmTool: (conversationId, toolCallId, confirmed) =>
      ipcRenderer.invoke(CHAT_IPC_CHANNELS.CONFIRM_TOOL, conversationId, toolCallId, confirmed),
    cancelStream: conversationId =>
      ipcRenderer.invoke(CHAT_IPC_CHANNELS.CANCEL_STREAM, conversationId),
    onStreamChunk: callback => createEventListener(CHAT_IPC_CHANNELS.STREAM_CHUNK, callback),
  },

  serverFs: {
    getDrives: connectionId => ipcRenderer.invoke(IPC_CHANNELS.SERVER_FS.GET_DRIVES, connectionId),
    listDirectory: (connectionId, path, includeFiles) =>
      ipcRenderer.invoke(IPC_CHANNELS.SERVER_FS.LIST_DIRECTORY, connectionId, path, includeFiles),
    getDefaultPaths: connectionId =>
      ipcRenderer.invoke(IPC_CHANNELS.SERVER_FS.GET_DEFAULT_PATHS, connectionId),
  },

  backup: {
    start: request => ipcRenderer.invoke(IPC_CHANNELS.BACKUP.START, request),
    cancel: backupId => ipcRenderer.invoke(IPC_CHANNELS.BACKUP.CANCEL, backupId),
    getHistory: (connectionId, databaseName) =>
      ipcRenderer.invoke(IPC_CHANNELS.BACKUP.GET_HISTORY, connectionId, databaseName),
    onProgress: callback => createEventListener(IPC_CHANNELS.BACKUP.PROGRESS, callback),
    checkTools: engine => ipcRenderer.invoke(IPC_CHANNELS.BACKUP.CHECK_TOOLS, engine),
    recheckTools: engine => ipcRenderer.invoke(IPC_CHANNELS.BACKUP.RECHECK_TOOLS, engine),
  },

  restore: {
    start: request => ipcRenderer.invoke(IPC_CHANNELS.RESTORE.START, request),
    cancel: restoreId => ipcRenderer.invoke(IPC_CHANNELS.RESTORE.CANCEL, restoreId),
    getFileList: (connectionId, backupPath) =>
      ipcRenderer.invoke(IPC_CHANNELS.RESTORE.GET_FILE_LIST, connectionId, backupPath),
    getBackupInfo: (connectionId, backupPath) =>
      ipcRenderer.invoke(IPC_CHANNELS.RESTORE.GET_BACKUP_INFO, connectionId, backupPath),
    onProgress: callback => createEventListener(IPC_CHANNELS.RESTORE.PROGRESS, callback),
  },

  logs: {
    getRecent: limit => ipcRenderer.invoke(IPC_CHANNELS.LOG.GET_RECENT, limit),
    append: entry => ipcRenderer.invoke(IPC_CHANNELS.LOG.APPEND, entry),
    onEntry: callback => createEventListener(IPC_CHANNELS.LOG.ENTRY, callback),
    revealFile: () => ipcRenderer.invoke(IPC_CHANNELS.LOG.REVEAL_FILE),
  },

  app: {
    getVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP.GET_VERSION),
    openExternal: url => ipcRenderer.invoke(IPC_CHANNELS.APP.OPEN_EXTERNAL, url),
    showOpenDialog: options => ipcRenderer.invoke(IPC_CHANNELS.APP.SHOW_OPEN_DIALOG, options),
    showSaveDialog: options => ipcRenderer.invoke(IPC_CHANNELS.APP.SHOW_SAVE_DIALOG, options),
    // State persistence
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.APP.GET_STATE),
    setState: partial => ipcRenderer.invoke(IPC_CHANNELS.APP.SET_STATE, partial),
    saveTabs: (tabs, activeTabId) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_TABS, tabs, activeTabId),
    getTabs: () => ipcRenderer.invoke(IPC_CHANNELS.APP.GET_TABS),
    // GoldenLayout persistence
    saveLayout: config => ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_LAYOUT, config),
    getLayout: () => ipcRenderer.invoke(IPC_CHANNELS.APP.GET_LAYOUT),
    saveToFile: (options, content) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_TO_FILE, options, content),
  },

  workspace: {
    openFolder: path => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE.OPEN_FOLDER, path),
    getFiles: path => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE.GET_FILES, path),
    readFile: filePath => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE.READ_FILE, filePath),
    writeFile: (filePath, content) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE.WRITE_FILE, filePath, content),
    createFile: (filePath, content) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE.CREATE_FILE, filePath, content),
    deleteFile: filePath => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE.DELETE_FILE, filePath),
    renameFile: (oldPath, newPath) =>
      ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE.RENAME_FILE, oldPath, newPath),
    onFileChanged: callback => createEventListener(IPC_CHANNELS.WORKSPACE.FILE_CHANGED, callback),
  },

  // MemberJunction Integration
  mj: {
    detect: (connectionId, database, mjSchemaName) =>
      ipcRenderer.invoke(IPC_CHANNELS.MJ.DETECT, connectionId, database, mjSchemaName),
    getEntities: (connectionId, database, mjSchemaName) =>
      ipcRenderer.invoke(IPC_CHANNELS.MJ.GET_ENTITIES, connectionId, database, mjSchemaName),
    getEntityFields: (connectionId, database, entityId, mjSchemaName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.MJ.GET_ENTITY_FIELDS,
        connectionId,
        database,
        entityId,
        mjSchemaName
      ),
    getApplications: (connectionId, database, mjSchemaName) =>
      ipcRenderer.invoke(IPC_CHANNELS.MJ.GET_APPLICATIONS, connectionId, database, mjSchemaName),
    getEntityRelationships: (connectionId, database, entityId, mjSchemaName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.MJ.GET_ENTITY_RELATIONSHIPS,
        connectionId,
        database,
        entityId,
        mjSchemaName
      ),
    getRecordChanges: (connectionId, database, options, mjSchemaName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.MJ.GET_RECORD_CHANGES,
        connectionId,
        database,
        options,
        mjSchemaName
      ),
    getAuditLogs: (connectionId, database, options, mjSchemaName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.MJ.GET_AUDIT_LOGS,
        connectionId,
        database,
        options,
        mjSchemaName
      ),
    getSavedQueries: (connectionId, database, categoryId, mjSchemaName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.MJ.GET_SAVED_QUERIES,
        connectionId,
        database,
        categoryId,
        mjSchemaName
      ),
    getErrorLogs: (connectionId, database, options, mjSchemaName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.MJ.GET_ERROR_LOGS,
        connectionId,
        database,
        options,
        mjSchemaName
      ),
    getUserRecordLogs: (connectionId, database, options, mjSchemaName) =>
      ipcRenderer.invoke(
        IPC_CHANNELS.MJ.GET_USER_RECORD_LOGS,
        connectionId,
        database,
        options,
        mjSchemaName
      ),
  },

  theme: {
    getNative: () => ipcRenderer.invoke(IPC_CHANNELS.THEME.GET_NATIVE),
    onChanged: callback => createEventListener(IPC_CHANNELS.THEME.CHANGED, callback),
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
    onCopy: callback => createEventListener(MENU_CHANNELS.COPY, callback),
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
    onShowWelcome: callback => createEventListener(MENU_CHANNELS.SHOW_WELCOME, callback),
    onToggleSidebar: callback => createEventListener(MENU_CHANNELS.TOGGLE_SIDEBAR, callback),
    onToggleChat: callback => createEventListener(MENU_CHANNELS.TOGGLE_CHAT, callback),
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
