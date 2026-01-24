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
  },

  // Backup Operations
  BACKUP: {
    START: 'backup:start',
    CANCEL: 'backup:cancel',
    PROGRESS: 'backup:progress',
    COMPLETE: 'backup:complete',
    ERROR: 'backup:error',
  },

  // Restore Operations
  RESTORE: {
    START: 'restore:start',
    CANCEL: 'restore:cancel',
    GET_FILE_LIST: 'restore:get-file-list',
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
  },
} as const;

export type IpcChannels = typeof IPC_CHANNELS;
