/**
 * IPC Channel definitions for communication between main and renderer processes
 */
export const IPC_CHANNELS = {
  // Connection Management
  CONNECTION: {
    TEST: 'connection:test',
    SAVE: 'connection:save',
    DELETE: 'connection:delete',
    LIST: 'connection:list',
    CONNECT: 'connection:connect',
    DISCONNECT: 'connection:disconnect',
  },

  // Docker Detection
  DOCKER: {
    DETECT: 'docker:detect',
    GET_CONTAINERS: 'docker:get-containers',
    GET_VOLUMES: 'docker:get-volumes',
    START_CONTAINER: 'docker:start-container',
    STOP_CONTAINER: 'docker:stop-container',
  },

  // Database Operations
  DATABASE: {
    LIST: 'database:list',
    CREATE: 'database:create',
    RENAME: 'database:rename',
    DELETE: 'database:delete',
    GET_INFO: 'database:get-info',
  },

  // Object Explorer
  EXPLORER: {
    GET_CHILDREN: 'explorer:get-children',
    GET_OBJECT_DETAILS: 'explorer:get-object-details',
    REFRESH_NODE: 'explorer:refresh-node',
    LIST_SCHEMAS: 'explorer:list-schemas',
    // Table metadata
    GET_TABLE_COLUMNS: 'explorer:get-table-columns',
    GET_TABLE_INDEXES: 'explorer:get-table-indexes',
    GET_TABLE_KEYS: 'explorer:get-table-keys',
    GET_TABLE_CONSTRAINTS: 'explorer:get-table-constraints',
    GET_TABLE_TRIGGERS: 'explorer:get-table-triggers',
    GET_TABLE_METADATA: 'explorer:get-table-metadata',
    GET_TABLE_PROPERTIES: 'explorer:get-table-properties',
    GET_EXTENDED_PROPERTIES: 'explorer:get-extended-properties',
    GET_ENRICHED_COLUMNS: 'explorer:get-enriched-columns',
    // Scripting
    SCRIPT_TABLE_CREATE: 'explorer:script-table-create',
    SCRIPT_TABLE_INSERT: 'explorer:script-table-insert',
    // Legacy
    GET_TABLES: 'explorer:get-tables',
    GET_VIEWS: 'explorer:get-views',
    GET_PROCEDURES: 'explorer:get-procedures',
    GET_DEFINITION: 'explorer:get-definition',
    REFRESH: 'explorer:refresh',
  },

  // Query Execution
  QUERY: {
    EXECUTE: 'query:execute',
    CANCEL: 'query:cancel',
    // History
    GET_HISTORY: 'query:get-history',
    CLEAR_HISTORY: 'query:clear-history',
    DELETE_HISTORY_ENTRY: 'query:delete-history-entry',
    // Export
    EXPORT_RESULTS: 'query:export-results',
    // Foreign Key Navigation
    FETCH_FK_RECORD: 'query:fetch-fk-record',
  },

  // Query Results Persistence
  QUERY_RESULTS: {
    SAVE_SNAPSHOT: 'query-results:save-snapshot',
    GET_SNAPSHOTS: 'query-results:get-snapshots',
    GET_SNAPSHOT: 'query-results:get-snapshot',
    DELETE_SNAPSHOT: 'query-results:delete-snapshot',
    DELETE_SNAPSHOTS: 'query-results:delete-snapshots',
    PIN_SNAPSHOT: 'query-results:pin-snapshot',
    UNPIN_SNAPSHOT: 'query-results:unpin-snapshot',
    LABEL_SNAPSHOT: 'query-results:label-snapshot',
    GET_STORAGE_STATS: 'query-results:get-storage-stats',
    PURGE: 'query-results:purge',
    COMPARE_SNAPSHOTS: 'query-results:compare-snapshots',
  },

  // AI Integration
  AI: {
    GET_VENDORS: 'ai:get-vendors',
    GET_SETTINGS: 'ai:get-settings',
    SET_SETTINGS: 'ai:set-settings',
    SET_API_KEY: 'ai:set-api-key',
    REMOVE_API_KEY: 'ai:remove-api-key',
    VALIDATE_API_KEY: 'ai:validate-api-key',
    GENERATE_TAB_NAME: 'ai:generate-tab-name',
    ANALYZE_RESULTS: 'ai:analyze-results',
    GENERATE_SQL: 'ai:generate-sql',
    CANCEL_REQUEST: 'ai:cancel-request',
  },

  // Server File System (browsing SQL Server's file system)
  SERVER_FS: {
    GET_DRIVES: 'server-fs:get-drives',
    LIST_DIRECTORY: 'server-fs:list-directory',
    GET_DEFAULT_PATHS: 'server-fs:get-default-paths',
  },

  // Backup Operations
  BACKUP: {
    START: 'backup:start',
    CANCEL: 'backup:cancel',
    PROGRESS: 'backup:progress',
    COMPLETE: 'backup:complete',
    ERROR: 'backup:error',
    GET_HISTORY: 'backup:get-history',
  },

  // Restore Operations
  RESTORE: {
    START: 'restore:start',
    CANCEL: 'restore:cancel',
    GET_FILE_LIST: 'restore:get-file-list',
    GET_BACKUP_INFO: 'restore:get-backup-info',
    PROGRESS: 'restore:progress',
    COMPLETE: 'restore:complete',
    ERROR: 'restore:error',
    // Legacy
    READ_INFO: 'restore:read-info',
  },

  // Settings
  SETTINGS: {
    GET: 'settings:get',
    SET: 'settings:set',
  },

  // App
  APP: {
    GET_VERSION: 'app:get-version',
    OPEN_EXTERNAL: 'app:open-external',
    SHOW_IN_FOLDER: 'app:show-in-folder',
    SHOW_OPEN_DIALOG: 'app:show-open-dialog',
    SHOW_SAVE_DIALOG: 'app:show-save-dialog',
    // State persistence
    GET_STATE: 'app:get-state',
    SET_STATE: 'app:set-state',
    SAVE_TABS: 'app:save-tabs',
    GET_TABS: 'app:get-tabs',
    // GoldenLayout persistence
    SAVE_LAYOUT: 'app:save-layout',
    GET_LAYOUT: 'app:get-layout',
  },

  // Workspace (for file/folder support)
  WORKSPACE: {
    OPEN_FOLDER: 'workspace:open-folder',
    GET_FILES: 'workspace:get-files',
    READ_FILE: 'workspace:read-file',
    WRITE_FILE: 'workspace:write-file',
    CREATE_FILE: 'workspace:create-file',
    DELETE_FILE: 'workspace:delete-file',
    RENAME_FILE: 'workspace:rename-file',
    WATCH: 'workspace:watch',
    UNWATCH: 'workspace:unwatch',
    FILE_CHANGED: 'workspace:file-changed',
  },

  // MemberJunction Integration
  MJ: {
    DETECT: 'mj:detect',
    GET_ENTITIES: 'mj:get-entities',
    GET_ENTITY_FIELDS: 'mj:get-entity-fields',
    GET_APPLICATIONS: 'mj:get-applications',
    GET_ENTITY_RELATIONSHIPS: 'mj:get-entity-relationships',
    GET_RECORD_CHANGES: 'mj:get-record-changes',
    GET_AUDIT_LOGS: 'mj:get-audit-logs',
    GET_SAVED_QUERIES: 'mj:get-saved-queries',
    GET_ERROR_LOGS: 'mj:get-error-logs',
    GET_USER_RECORD_LOGS: 'mj:get-user-record-logs',
  },
} as const;

export type IpcChannels = typeof IPC_CHANNELS;
