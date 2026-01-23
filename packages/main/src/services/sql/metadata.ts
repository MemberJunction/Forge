/**
 * Metadata Service
 * Queries SQL Server for database metadata
 */

import type {
  DatabaseInfo,
  TableInfo,
  ViewInfo,
  ProcedureInfo,
  ObjectDefinition,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
} from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { ObjectCache } from '../../utils/object-cache';
import { TsqlBuilder } from '../../utils/tsql-builder';
import { ConnectionPoolManager } from './connection-pool';

export class MetadataService extends BaseSingleton {
  private poolManager: ConnectionPoolManager;
  private databaseCache: ObjectCache<DatabaseInfo[]>;
  private tableCache: ObjectCache<TableInfo[]>;
  private viewCache: ObjectCache<ViewInfo[]>;
  private procedureCache: ObjectCache<ProcedureInfo[]>;

  constructor() {
    super();
    this.poolManager = ConnectionPoolManager.getInstance();

    // Caches with 1 minute TTL
    this.databaseCache = new ObjectCache({ ttlMs: 60000 });
    this.tableCache = new ObjectCache({ ttlMs: 60000 });
    this.viewCache = new ObjectCache({ ttlMs: 60000 });
    this.procedureCache = new ObjectCache({ ttlMs: 60000 });
  }

  /**
   * List all databases on a connection
   */
  async listDatabases(connectionId: string, forceRefresh = false): Promise<DatabaseInfo[]> {
    const cacheKey = `databases:${connectionId}`;

    if (!forceRefresh) {
      const cached = this.databaseCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const sql = TsqlBuilder.listDatabases();
    const result = await this.poolManager.query<DatabaseInfo>(connectionId, sql);

    const databases = result.recordset.map(row => ({
      ...row,
      isSystemDb: Boolean(row.isSystemDb),
      state: (row.state?.toLowerCase() || 'online') as DatabaseInfo['state'],
      recoveryModel: (row.recoveryModel?.toLowerCase() ||
        'simple') as DatabaseInfo['recoveryModel'],
    }));

    this.databaseCache.set(cacheKey, databases);
    return databases;
  }

  /**
   * List tables in a database
   */
  async listTables(
    connectionId: string,
    database: string,
    forceRefresh = false
  ): Promise<TableInfo[]> {
    const cacheKey = `tables:${connectionId}:${database}`;

    if (!forceRefresh) {
      const cached = this.tableCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const sql = TsqlBuilder.listTables(database);
    const result = await this.poolManager.query<TableInfo>(connectionId, sql);

    this.tableCache.set(cacheKey, result.recordset);
    return result.recordset;
  }

  /**
   * List views in a database
   */
  async listViews(
    connectionId: string,
    database: string,
    forceRefresh = false
  ): Promise<ViewInfo[]> {
    const cacheKey = `views:${connectionId}:${database}`;

    if (!forceRefresh) {
      const cached = this.viewCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const sql = TsqlBuilder.listViews(database);
    const result = await this.poolManager.query<ViewInfo>(connectionId, sql);

    this.viewCache.set(cacheKey, result.recordset);
    return result.recordset;
  }

  /**
   * List stored procedures in a database
   */
  async listProcedures(
    connectionId: string,
    database: string,
    forceRefresh = false
  ): Promise<ProcedureInfo[]> {
    const cacheKey = `procedures:${connectionId}:${database}`;

    if (!forceRefresh) {
      const cached = this.procedureCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const sql = TsqlBuilder.listProcedures(database);
    const result = await this.poolManager.query<ProcedureInfo>(connectionId, sql);

    this.procedureCache.set(cacheKey, result.recordset);
    return result.recordset;
  }

  /**
   * Get the definition of a database object
   */
  async getObjectDefinition(
    connectionId: string,
    database: string,
    schema: string,
    name: string,
    objectType: string
  ): Promise<ObjectDefinition> {
    const sql = TsqlBuilder.getObjectDefinition(database, schema, name);
    const result = await this.poolManager.query<{ definition: string }>(connectionId, sql);

    return {
      objectType: objectType as ObjectDefinition['objectType'],
      schema,
      name,
      definition: result.recordset[0]?.definition || '-- Definition not available',
    };
  }

  /**
   * List columns for a table
   */
  async listColumns(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<ColumnInfo[]> {
    const sql = TsqlBuilder.listColumns(database, schema, table);
    const result = await this.poolManager.query<ColumnInfo>(connectionId, sql);
    return result.recordset.map(row => ({
      ...row,
      isNullable: Boolean(row.isNullable),
      isPrimaryKey: Boolean(row.isPrimaryKey),
      isForeignKey: Boolean(row.isForeignKey),
    }));
  }

  /**
   * List indexes for a table
   */
  async listIndexes(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<IndexInfo[]> {
    const sql = TsqlBuilder.listIndexes(database, schema, table);
    const result = await this.poolManager.query<{
      name: string;
      type: string;
      isUnique: boolean;
      isPrimaryKey: boolean;
      columns: string;
    }>(connectionId, sql);
    return result.recordset.map(row => ({
      name: row.name,
      type: row.type as IndexInfo['type'],
      isUnique: Boolean(row.isUnique),
      isPrimaryKey: Boolean(row.isPrimaryKey),
      columns: row.columns ? row.columns.split(', ') : [],
    }));
  }

  /**
   * List foreign keys for a table
   */
  async listForeignKeys(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<ForeignKeyInfo[]> {
    const sql = TsqlBuilder.listForeignKeys(database, schema, table);
    const result = await this.poolManager.query<{
      name: string;
      columns: string;
      referencedSchema: string;
      referencedTable: string;
      referencedColumns: string;
      onDelete: string;
      onUpdate: string;
    }>(connectionId, sql);
    return result.recordset.map(row => ({
      name: row.name,
      columns: row.columns ? row.columns.split(', ') : [],
      referencedSchema: row.referencedSchema,
      referencedTable: row.referencedTable,
      referencedColumns: row.referencedColumns ? row.referencedColumns.split(', ') : [],
      onDelete: row.onDelete as ForeignKeyInfo['onDelete'],
      onUpdate: row.onUpdate as ForeignKeyInfo['onUpdate'],
    }));
  }

  /**
   * List constraints for a table
   */
  async listConstraints(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<ConstraintInfo[]> {
    const sql = TsqlBuilder.listConstraints(database, schema, table);
    const result = await this.poolManager.query<{
      name: string;
      type: string;
      columns: string;
      definition: string;
    }>(connectionId, sql);
    return result.recordset.map(row => ({
      name: row.name,
      type: row.type as ConstraintInfo['type'],
      columns: row.columns ? row.columns.split(', ') : [],
      definition: row.definition,
    }));
  }

  /**
   * List triggers for a table
   */
  async listTriggers(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<TriggerInfo[]> {
    const sql = TsqlBuilder.listTriggers(database, schema, table);
    const result = await this.poolManager.query<{
      name: string;
      isDisabled: boolean;
      triggerType: string;
      createdAt: string;
    }>(connectionId, sql);
    return result.recordset.map(row => ({
      name: row.name,
      isEnabled: !row.isDisabled,
      triggerType: row.triggerType as TriggerInfo['triggerType'],
      createdAt: row.createdAt,
    }));
  }

  /**
   * Invalidate all caches for a connection
   */
  invalidateConnection(connectionId: string): void {
    this.databaseCache.invalidatePrefix(`databases:${connectionId}`);
    this.tableCache.invalidatePrefix(`tables:${connectionId}`);
    this.viewCache.invalidatePrefix(`views:${connectionId}`);
    this.procedureCache.invalidatePrefix(`procedures:${connectionId}`);
  }

  /**
   * Invalidate database list cache for a connection
   */
  invalidateDatabases(connectionId: string): void {
    this.databaseCache.invalidatePrefix(`databases:${connectionId}`);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.databaseCache.clear();
    this.tableCache.clear();
    this.viewCache.clear();
    this.procedureCache.clear();
  }
}
