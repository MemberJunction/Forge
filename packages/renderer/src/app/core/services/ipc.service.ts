import { Injectable, NgZone, inject } from '@angular/core';
import { Observable, Subject, from } from 'rxjs';
import type {
  ConnectionProfile,
  TestConnectionResult,
  DatabaseInfo,
  CreateDatabaseOptions,
  RenameDatabaseOptions,
  DeleteDatabaseOptions,
  DatabaseOperationResult,
  DockerStatus,
  DockerContainer,
  DockerVolume,
  QueryRequest,
  QueryResult,
  QueryHistoryEntry,
  QueryHistoryFilter,
  ExportOptions,
  ExportResult,
  ResultSet,
  BackupRequest,
  RestoreRequest,
  BackupProgress,
  RestoreProgress,
  ObjectMetadata,
  ObjectType,
  ObjectDefinition,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
  ExtendedProperty,
  TableProperties,
} from '@mj-forge/shared';

// Dialog types for Electron dialogs
export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: { name: string; extensions: string[] }[];
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
  >;
  message?: string;
}

export interface OpenDialogReturnValue {
  canceled: boolean;
  filePaths: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: { name: string; extensions: string[] }[];
  message?: string;
  nameFieldLabel?: string;
  showsTagField?: boolean;
}

export interface SaveDialogReturnValue {
  canceled: boolean;
  filePath?: string;
}

// Get the forge API from the preload script
declare global {
  interface Window {
    forge: ForgeAPI;
  }
}

interface ForgeAPI {
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
    showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
    showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
  };
  menu: {
    onNewConnection: (callback: () => void) => () => void;
    onNewQuery: (callback: () => void) => () => void;
    onOpenQuery: (callback: () => void) => () => void;
    onCloseTab: (callback: () => void) => () => void;
    onSaveQuery: (callback: () => void) => () => void;
    onSaveQueryAs: (callback: () => void) => () => void;
    onExportResults: (callback: () => void) => () => void;
    onFind: (callback: () => void) => () => void;
    onReplace: (callback: () => void) => () => void;
    onFormatSql: (callback: () => void) => () => void;
    onToggleComment: (callback: () => void) => () => void;
    onExecuteQuery: (callback: () => void) => () => void;
    onExecuteSelection: (callback: () => void) => () => void;
    onCancelQuery: (callback: () => void) => () => void;
    onQueryHistory: (callback: () => void) => () => void;
    onDisconnect: (callback: () => void) => () => void;
    onRefresh: (callback: () => void) => () => void;
    onServerProperties: (callback: () => void) => () => void;
    onNewDatabase: (callback: () => void) => () => void;
    onBackup: (callback: () => void) => () => void;
    onRestore: (callback: () => void) => () => void;
    onDatabaseProperties: (callback: () => void) => () => void;
    onToggleSidebar: (callback: () => void) => () => void;
    onToggleResults: (callback: () => void) => () => void;
    onNextTab: (callback: () => void) => () => void;
    onPreviousTab: (callback: () => void) => () => void;
    onOpenSettings: (callback: () => void) => () => void;
    onShowShortcuts: (callback: () => void) => () => void;
  };
}

@Injectable({ providedIn: 'root' })
export class IpcService {
  private readonly zone = inject(NgZone);
  private readonly backupProgress$ = new Subject<BackupProgress>();
  private readonly restoreProgress$ = new Subject<RestoreProgress>();
  private backupUnsubscribe?: () => void;
  private restoreUnsubscribe?: () => void;
  private _isAvailable = false;

  private get api(): ForgeAPI {
    if (!window.forge) {
      throw new Error('Forge API not available. Running outside Electron context?');
    }
    return window.forge;
  }

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  constructor() {
    // Check if running in Electron context
    this._isAvailable = typeof window !== 'undefined' && !!window.forge;

    if (!this._isAvailable) {
      console.warn('IpcService: Forge API not available. Running in browser mode.');
      return;
    }

    try {
      // Subscribe to backup progress events
      this.backupUnsubscribe = this.api.backup.onProgress(progress => {
        this.zone.run(() => this.backupProgress$.next(progress));
      });

      // Subscribe to restore progress events
      this.restoreUnsubscribe = this.api.restore.onProgress(progress => {
        this.zone.run(() => this.restoreProgress$.next(progress));
      });
    } catch (error) {
      console.error('IpcService: Failed to initialize event listeners:', error);
    }
  }

  // Connection methods
  testConnection(profile: ConnectionProfile, password?: string): Observable<TestConnectionResult> {
    return from(this.api.connection.test(profile, password));
  }

  saveConnection(
    profile: Partial<ConnectionProfile>,
    password?: string
  ): Observable<ConnectionProfile> {
    return from(this.api.connection.save(profile as ConnectionProfile, password));
  }

  deleteConnection(profileId: string): Observable<void> {
    return from(this.api.connection.delete(profileId));
  }

  listConnections(): Observable<ConnectionProfile[]> {
    return from(this.api.connection.list());
  }

  connect(profileId: string): Observable<void> {
    return from(this.api.connection.connect(profileId));
  }

  disconnect(profileId: string): Observable<void> {
    return from(this.api.connection.disconnect(profileId));
  }

  // Docker methods
  detectDocker(): Observable<DockerStatus> {
    return from(this.api.docker.detect());
  }

  getDockerContainers(): Observable<DockerContainer[]> {
    return from(this.api.docker.getContainers());
  }

  getDockerVolumes(): Observable<DockerVolume[]> {
    return from(this.api.docker.getVolumes());
  }

  startDockerContainer(containerId: string): Observable<void> {
    return from(this.api.docker.startContainer(containerId));
  }

  stopDockerContainer(containerId: string): Observable<void> {
    return from(this.api.docker.stopContainer(containerId));
  }

  // Database methods
  listDatabases(connectionId: string): Observable<DatabaseInfo[]> {
    return from(this.api.database.list(connectionId));
  }

  createDatabase(
    connectionId: string,
    options: CreateDatabaseOptions
  ): Observable<DatabaseOperationResult> {
    return from(this.api.database.create(connectionId, options));
  }

  renameDatabase(
    connectionId: string,
    options: RenameDatabaseOptions
  ): Observable<DatabaseOperationResult> {
    return from(this.api.database.rename(connectionId, options));
  }

  deleteDatabase(
    connectionId: string,
    options: DeleteDatabaseOptions
  ): Observable<DatabaseOperationResult> {
    return from(this.api.database.delete(connectionId, options));
  }

  getDatabaseInfo(connectionId: string, databaseName: string): Observable<DatabaseInfo> {
    return from(this.api.database.getInfo(connectionId, databaseName));
  }

  // Explorer methods
  getExplorerChildren(
    connectionId: string,
    databaseName: string,
    parentPath: string
  ): Observable<ObjectMetadata[]> {
    return from(this.api.explorer.getChildren(connectionId, databaseName, parentPath));
  }

  getObjectDetails(
    connectionId: string,
    databaseName: string,
    objectType: ObjectType,
    objectName: string,
    schema?: string
  ): Observable<ObjectMetadata> {
    return from(
      this.api.explorer.getObjectDetails(connectionId, databaseName, objectType, objectName, schema)
    );
  }

  refreshExplorerNode(
    connectionId: string,
    databaseName: string,
    path: string
  ): Observable<ObjectMetadata[]> {
    return from(this.api.explorer.refreshNode(connectionId, databaseName, path));
  }

  getTableColumns(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<ColumnInfo[]> {
    return from(this.api.explorer.getTableColumns(connectionId, databaseName, schema, tableName));
  }

  getTableIndexes(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<IndexInfo[]> {
    return from(this.api.explorer.getTableIndexes(connectionId, databaseName, schema, tableName));
  }

  getTableKeys(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<ForeignKeyInfo[]> {
    return from(this.api.explorer.getTableKeys(connectionId, databaseName, schema, tableName));
  }

  getTableConstraints(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<ConstraintInfo[]> {
    return from(
      this.api.explorer.getTableConstraints(connectionId, databaseName, schema, tableName)
    );
  }

  getTableTriggers(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<TriggerInfo[]> {
    return from(this.api.explorer.getTableTriggers(connectionId, databaseName, schema, tableName));
  }

  // Query methods
  executeQuery(request: QueryRequest): Observable<QueryResult> {
    return from(this.api.query.execute(request));
  }

  cancelQuery(queryId: string): Observable<void> {
    return from(this.api.query.cancel(queryId));
  }

  getQueryHistory(filter?: QueryHistoryFilter): Observable<QueryHistoryEntry[]> {
    return from(this.api.query.getHistory(filter));
  }

  clearQueryHistory(): Observable<void> {
    return from(this.api.query.clearHistory());
  }

  deleteQueryHistoryEntry(id: string): Observable<boolean> {
    return from(this.api.query.deleteHistoryEntry(id));
  }

  exportQueryResults(resultSet: ResultSet, options: ExportOptions): Observable<ExportResult> {
    return from(this.api.query.exportResults(resultSet, options));
  }

  // Backup methods
  startBackup(request: BackupRequest): Observable<void> {
    return from(this.api.backup.start(request));
  }

  cancelBackup(backupId: string): Observable<void> {
    return from(this.api.backup.cancel(backupId));
  }

  getBackupProgress(): Observable<BackupProgress> {
    return this.backupProgress$.asObservable();
  }

  // Restore methods
  startRestore(request: RestoreRequest): Observable<void> {
    return from(this.api.restore.start(request));
  }

  cancelRestore(restoreId: string): Observable<void> {
    return from(this.api.restore.cancel(restoreId));
  }

  getRestoreFileList(
    connectionId: string,
    backupPath: string
  ): Observable<{ logicalName: string; physicalName: string; type: string }[]> {
    return from(this.api.restore.getFileList(connectionId, backupPath));
  }

  getRestoreProgress(): Observable<RestoreProgress> {
    return this.restoreProgress$.asObservable();
  }

  // App methods
  getAppVersion(): Observable<string> {
    return from(this.api.app.getVersion());
  }

  openExternal(url: string): Observable<void> {
    return from(this.api.app.openExternal(url));
  }

  showOpenDialog(options: OpenDialogOptions): Observable<OpenDialogReturnValue> {
    return from(this.api.app.showOpenDialog(options));
  }

  showSaveDialog(options: SaveDialogOptions): Observable<SaveDialogReturnValue> {
    return from(this.api.app.showSaveDialog(options));
  }
}
