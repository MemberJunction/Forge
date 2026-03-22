/**
 * Metadata Service
 * Queries SQL Server for database metadata
 */

import type {
  DatabaseInfo,
  SchemaInfo,
  TableInfo,
  ViewInfo,
  ProcedureInfo,
  FunctionInfo,
  ObjectDefinition,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
  ExtendedProperty,
  TableProperties,
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
} from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { ObjectCache } from '../../utils/object-cache';
import { TsqlBuilder } from '../../utils/tsql-builder';
import { createLogger } from '../../utils/logger';
import { ConnectionPoolManager } from './connection-pool';

const log = createLogger('Metadata');

export class MetadataService extends BaseSingleton {
  private poolManager: ConnectionPoolManager;
  private databaseCache: ObjectCache<DatabaseInfo[]>;
  private schemaCache: ObjectCache<SchemaInfo[]>;
  private tableCache: ObjectCache<TableInfo[]>;
  private viewCache: ObjectCache<ViewInfo[]>;
  private procedureCache: ObjectCache<ProcedureInfo[]>;
  private functionCache: ObjectCache<FunctionInfo[]>;

  /** Escape a SQL identifier for use inside square brackets (doubles any `]` characters) */
  private escId(name: string): string {
    return name.replace(/\]/g, ']]');
  }

  /** Escape a string value for use inside single quotes (doubles any `'` characters) */
  private escStr(value: string): string {
    return value.replace(/'/g, "''");
  }

  constructor() {
    super();
    this.poolManager = ConnectionPoolManager.getInstance();

    // Caches with 1 minute TTL
    this.databaseCache = new ObjectCache({ ttlMs: 60000 });
    this.schemaCache = new ObjectCache({ ttlMs: 60000 });
    this.tableCache = new ObjectCache({ ttlMs: 60000 });
    this.viewCache = new ObjectCache({ ttlMs: 60000 });
    this.procedureCache = new ObjectCache({ ttlMs: 60000 });
    this.functionCache = new ObjectCache({ ttlMs: 60000 });
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
   * List schemas in a database (excluding system schemas)
   */
  async listSchemas(
    connectionId: string,
    database: string,
    forceRefresh = false
  ): Promise<SchemaInfo[]> {
    const cacheKey = `schemas:${connectionId}:${database}`;

    if (!forceRefresh) {
      const cached = this.schemaCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const sql = TsqlBuilder.listSchemas(database);
    const result = await this.poolManager.query<SchemaInfo>(connectionId, sql);

    const schemas = result.recordset.map(row => ({
      ...row,
      isSystem: Boolean(row.isSystem),
    }));

    this.schemaCache.set(cacheKey, schemas);
    return schemas;
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
   * List user-defined functions in a database
   */
  async listFunctions(
    connectionId: string,
    database: string,
    forceRefresh = false
  ): Promise<FunctionInfo[]> {
    const cacheKey = `functions:${connectionId}:${database}`;

    if (!forceRefresh) {
      const cached = this.functionCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const sql = TsqlBuilder.listFunctions(database);
    const result = await this.poolManager.query<FunctionInfo>(connectionId, sql);

    this.functionCache.set(cacheKey, result.recordset);
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
   * List extended properties for a table and its columns
   */
  async listExtendedProperties(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<ExtendedProperty[]> {
    const sql = TsqlBuilder.listExtendedProperties(database, schema, table);
    const result = await this.poolManager.query<ExtendedProperty>(connectionId, sql);
    return result.recordset;
  }

  /**
   * Get comprehensive table properties including space, storage, and all metadata
   */
  async getTableProperties(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<TableProperties> {
    // Get basic properties
    const propertiesSql = TsqlBuilder.getTableProperties(database, schema, table);
    const propertiesResult = await this.poolManager.query<{
      schema: string;
      name: string;
      objectId: number;
      createdAt: string;
      modifiedAt: string;
      rowCount: number;
      dataSpaceKb: number;
      indexSpaceKb: number;
      unusedSpaceKb: number;
      totalSpaceKb: number;
      hasIdentity: boolean;
      identityColumn: string;
      identitySeed: number;
      identityIncrement: number;
      isReplicated: boolean;
      hasTextImage: boolean;
      textImageOnFilegroup: string;
      filegroup: string;
    }>(connectionId, propertiesSql);

    const baseProps = propertiesResult.recordset[0];
    if (!baseProps) {
      throw new Error(`Table ${schema}.${table} not found`);
    }

    // Get all related metadata in parallel
    const [columns, indexes, foreignKeys, constraints, triggers, extendedProperties] =
      await Promise.all([
        this.listColumns(connectionId, database, schema, table),
        this.listIndexes(connectionId, database, schema, table),
        this.listForeignKeys(connectionId, database, schema, table),
        this.listConstraints(connectionId, database, schema, table),
        this.listTriggers(connectionId, database, schema, table),
        this.listExtendedProperties(connectionId, database, schema, table),
      ]);

    return {
      schema: baseProps.schema,
      name: baseProps.name,
      objectId: baseProps.objectId,
      createdAt: baseProps.createdAt,
      modifiedAt: baseProps.modifiedAt,
      rowCount: baseProps.rowCount || 0,
      dataSpaceKb: baseProps.dataSpaceKb || 0,
      indexSpaceKb: baseProps.indexSpaceKb || 0,
      unusedSpaceKb: baseProps.unusedSpaceKb || 0,
      totalSpaceKb: baseProps.totalSpaceKb || 0,
      hasIdentity: Boolean(baseProps.hasIdentity),
      identityColumn: baseProps.identityColumn || undefined,
      identitySeed: baseProps.identitySeed || undefined,
      identityIncrement: baseProps.identityIncrement || undefined,
      isReplicated: Boolean(baseProps.isReplicated),
      hasTextImage: Boolean(baseProps.hasTextImage),
      textImageOnFilegroup: baseProps.textImageOnFilegroup || undefined,
      filegroup: baseProps.filegroup || 'PRIMARY',
      columns,
      indexes,
      foreignKeys,
      constraints,
      triggers,
      extendedProperties,
    };
  }

  /**
   * Generate CREATE TABLE script
   */
  async scriptTableAsCreate(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<string> {
    // Get column data
    const columnsSql = TsqlBuilder.getTableScriptData(database, schema, table);
    const columnsResult = await this.poolManager.query<{
      ordinalPosition: number;
      columnName: string;
      dataType: string;
      maxLength: number;
      precision: number;
      scale: number;
      isNullable: boolean;
      isIdentity: boolean;
      identitySeed: number;
      identityIncrement: number;
      defaultValue: string;
      defaultConstraintName: string;
      computedDefinition: string;
      computedIsPersisted: boolean;
    }>(connectionId, columnsSql);

    // Get primary key
    const pkSql = TsqlBuilder.getPrimaryKeyScript(database, schema, table);
    const pkResult = await this.poolManager.query<{
      constraintName: string;
      indexType: string;
      columns: string;
    }>(connectionId, pkSql);

    // Get foreign keys
    const fkSql = TsqlBuilder.getForeignKeyScript(database, schema, table);
    const fkResult = await this.poolManager.query<{
      constraintName: string;
      columns: string;
      referencedSchema: string;
      referencedTable: string;
      referencedColumns: string;
      onDelete: string;
      onUpdate: string;
    }>(connectionId, fkSql);

    // Get other constraints
    const constraintsSql = TsqlBuilder.getConstraintsScript(database, schema, table);
    const constraintsResult = await this.poolManager.query<{
      constraintType: string;
      constraintName: string;
      indexType: string;
      columns: string;
      definition: string;
    }>(connectionId, constraintsSql);

    // Get indexes
    const indexesSql = TsqlBuilder.getIndexesScript(database, schema, table);
    const indexesResult = await this.poolManager.query<{
      indexName: string;
      indexType: string;
      isUnique: boolean;
      keyColumns: string;
      includedColumns: string;
      filterDefinition: string;
    }>(connectionId, indexesSql);

    // Build the CREATE TABLE script
    return this.buildCreateTableScript(
      schema,
      table,
      columnsResult.recordset,
      pkResult.recordset[0],
      fkResult.recordset,
      constraintsResult.recordset,
      indexesResult.recordset
    );
  }

  /**
   * Build CREATE TABLE script from metadata
   */
  private buildCreateTableScript(
    schema: string,
    table: string,
    columns: Array<{
      columnName: string;
      dataType: string;
      maxLength: number;
      precision: number;
      scale: number;
      isNullable: boolean;
      isIdentity: boolean;
      identitySeed: number;
      identityIncrement: number;
      defaultValue: string;
      computedDefinition: string;
      computedIsPersisted: boolean;
    }>,
    primaryKey: { constraintName: string; indexType: string; columns: string } | undefined,
    foreignKeys: Array<{
      constraintName: string;
      columns: string;
      referencedSchema: string;
      referencedTable: string;
      referencedColumns: string;
      onDelete: string;
      onUpdate: string;
    }>,
    constraints: Array<{
      constraintType: string;
      constraintName: string;
      indexType: string;
      columns: string;
      definition: string;
    }>,
    indexes: Array<{
      indexName: string;
      indexType: string;
      isUnique: boolean;
      keyColumns: string;
      includedColumns: string;
      filterDefinition: string;
    }>
  ): string {
    const lines: string[] = [];
    lines.push(`CREATE TABLE [${schema}].[${table}]`);
    lines.push('(');

    // Columns
    const columnDefs: string[] = [];
    for (const col of columns) {
      let def = `    [${col.columnName}]`;

      if (col.computedDefinition) {
        def += ` AS ${col.computedDefinition}`;
        if (col.computedIsPersisted) {
          def += ' PERSISTED';
        }
      } else {
        def += ` ${this.formatColumnType(col)}`;

        if (col.isIdentity) {
          def += ` IDENTITY(${col.identitySeed || 1},${col.identityIncrement || 1})`;
        }

        def += col.isNullable ? ' NULL' : ' NOT NULL';

        if (col.defaultValue) {
          def += ` DEFAULT ${col.defaultValue}`;
        }
      }

      columnDefs.push(def);
    }

    // Primary Key
    if (primaryKey) {
      const pkType = primaryKey.indexType === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
      columnDefs.push(
        `    CONSTRAINT [${primaryKey.constraintName}] PRIMARY KEY ${pkType} (${primaryKey.columns})`
      );
    }

    // Unique constraints
    for (const c of constraints.filter(x => x.constraintType === 'UNIQUE')) {
      const uqType = c.indexType === 'CLUSTERED' ? 'CLUSTERED' : 'NONCLUSTERED';
      columnDefs.push(`    CONSTRAINT [${c.constraintName}] UNIQUE ${uqType} (${c.columns})`);
    }

    // Check constraints
    for (const c of constraints.filter(x => x.constraintType === 'CHECK')) {
      columnDefs.push(`    CONSTRAINT [${c.constraintName}] CHECK ${c.definition}`);
    }

    // Foreign keys
    for (const fk of foreignKeys) {
      let fkDef = `    CONSTRAINT [${fk.constraintName}] FOREIGN KEY (${fk.columns})`;
      fkDef += ` REFERENCES [${fk.referencedSchema}].[${fk.referencedTable}] (${fk.referencedColumns})`;
      if (fk.onDelete && fk.onDelete !== 'NO_ACTION') {
        fkDef += ` ON DELETE ${fk.onDelete.replace('_', ' ')}`;
      }
      if (fk.onUpdate && fk.onUpdate !== 'NO_ACTION') {
        fkDef += ` ON UPDATE ${fk.onUpdate.replace('_', ' ')}`;
      }
      columnDefs.push(fkDef);
    }

    lines.push(columnDefs.join(',\n'));
    lines.push(');');
    lines.push('GO');

    // Non-clustered indexes (separate statements)
    for (const idx of indexes) {
      lines.push('');
      let idxDef = `CREATE`;
      if (idx.isUnique) {
        idxDef += ' UNIQUE';
      }
      idxDef += ` ${idx.indexType} INDEX [${idx.indexName}]`;
      idxDef += ` ON [${schema}].[${table}] (${idx.keyColumns})`;
      if (idx.includedColumns) {
        idxDef += ` INCLUDE (${idx.includedColumns})`;
      }
      if (idx.filterDefinition) {
        idxDef += ` WHERE ${idx.filterDefinition}`;
      }
      idxDef += ';';
      lines.push(idxDef);
      lines.push('GO');
    }

    return lines.join('\n');
  }

  /**
   * Format column type for CREATE TABLE
   */
  private formatColumnType(col: {
    dataType: string;
    maxLength: number;
    precision: number;
    scale: number;
  }): string {
    const type = col.dataType.toLowerCase();

    // Types with length
    if (['varchar', 'nvarchar', 'char', 'nchar', 'binary', 'varbinary'].includes(type)) {
      const len =
        col.maxLength === -1 ? 'MAX' : type.startsWith('n') ? col.maxLength / 2 : col.maxLength;
      return `[${col.dataType}](${len})`;
    }

    // Types with precision and scale
    if (['decimal', 'numeric'].includes(type)) {
      return `[${col.dataType}](${col.precision}, ${col.scale})`;
    }

    // Types with only precision
    if (['float'].includes(type) && col.precision !== 53) {
      return `[${col.dataType}](${col.precision})`;
    }

    // Types with scale only (datetime2, time, datetimeoffset)
    if (['datetime2', 'time', 'datetimeoffset'].includes(type) && col.scale !== 7) {
      return `[${col.dataType}](${col.scale})`;
    }

    return `[${col.dataType}]`;
  }

  /**
   * Generate INSERT statement template for a table
   */
  async scriptTableAsInsert(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<string> {
    const columns = await this.listColumns(connectionId, database, schema, table);
    const columnData = columns.map(c => ({
      name: c.name,
      dataType: c.dataType,
      isIdentity: false, // We'll check via the column query
    }));

    // Get identity info
    const columnsSql = TsqlBuilder.getTableScriptData(database, schema, table);
    const result = await this.poolManager.query<{
      columnName: string;
      isIdentity: boolean;
    }>(connectionId, columnsSql);

    for (const r of result.recordset) {
      const col = columnData.find(c => c.name === r.columnName);
      if (col) {
        col.isIdentity = Boolean(r.isIdentity);
      }
    }

    return TsqlBuilder.generateInsertTemplate(schema, table, columnData);
  }

  /**
   * Get enriched column metadata for a table with PK/FK info
   * Returns data in the format expected by ColumnMetadata (for query results)
   */
  async getEnrichedColumnMetadata(
    connectionId: string,
    database: string,
    schema: string,
    table: string
  ): Promise<
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
  > {
    // Get columns and FK info in parallel
    const [columns, foreignKeys] = await Promise.all([
      this.listColumns(connectionId, database, schema, table),
      this.listForeignKeys(connectionId, database, schema, table),
    ]);

    // Get identity column info
    const identitySql = TsqlBuilder.getTableScriptData(database, schema, table);
    const identityResult = await this.poolManager.query<{
      columnName: string;
      isIdentity: boolean;
      defaultValue: string;
    }>(connectionId, identitySql);

    // Build a map of column -> FK info
    const fkMap = new Map<
      string,
      {
        referencedSchema: string;
        referencedTable: string;
        referencedColumn: string;
        constraintName: string;
      }
    >();
    for (const fk of foreignKeys) {
      // Handle composite FKs - each column maps to corresponding referenced column
      const cols = fk.columns;
      const refCols = fk.referencedColumns;
      for (let i = 0; i < cols.length; i++) {
        fkMap.set(cols[i], {
          referencedSchema: fk.referencedSchema,
          referencedTable: fk.referencedTable,
          referencedColumn: refCols[i] || refCols[0],
          constraintName: fk.name,
        });
      }
    }

    // Build a map of column -> identity/default info
    const identityMap = new Map<string, { isIdentity: boolean; defaultValue: string }>();
    for (const row of identityResult.recordset) {
      identityMap.set(row.columnName, {
        isIdentity: Boolean(row.isIdentity),
        defaultValue: row.defaultValue,
      });
    }

    return columns.map(col => ({
      name: col.name,
      type: col.dataType,
      nullable: col.isNullable,
      maxLength: col.maxLength ?? null,
      precision: col.precision ?? null,
      scale: col.scale ?? null,
      isPrimaryKey: col.isPrimaryKey ?? false,
      isIdentity: identityMap.get(col.name)?.isIdentity ?? false,
      defaultValue: identityMap.get(col.name)?.defaultValue ?? null,
      foreignKey: fkMap.get(col.name) ?? null,
    }));
  }

  // ============================================================
  // MemberJunction Detection & Metadata
  // ============================================================

  /**
   * Detect if a database has MemberJunction installed.
   * Checks for __mj schema and Entity/EntityField tables.
   */
  async detectMJDatabase(
    connectionId: string,
    database: string,
    mjSchemaName = '__mj'
  ): Promise<MJDatabaseInfo> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const mjStr = mjSchemaName.replace(/'/g, "''");

      // Check if the MJ schema exists and has the Entity table
      const detectSql = `
        USE [${db}];
        SELECT
          CASE WHEN SCHEMA_ID('${mjStr}') IS NOT NULL THEN 1 ELSE 0 END AS hasSchema,
          CASE WHEN OBJECT_ID('${mjStr}.Entity') IS NOT NULL THEN 1 ELSE 0 END AS hasEntityTable,
          CASE WHEN OBJECT_ID('${mjStr}.EntityField') IS NOT NULL THEN 1 ELSE 0 END AS hasEntityFieldTable,
          CASE WHEN OBJECT_ID('${mjStr}.User') IS NOT NULL THEN 1 ELSE 0 END AS hasUsers,
          CASE WHEN OBJECT_ID('${mjStr}.AuditLog') IS NOT NULL THEN 1 ELSE 0 END AS hasAuditLog,
          CASE WHEN OBJECT_ID('${mjStr}.Application') IS NOT NULL THEN 1 ELSE 0 END AS hasApplications
      `;

      const result = await this.poolManager.query<{
        hasSchema: number;
        hasEntityTable: number;
        hasEntityFieldTable: number;
        hasUsers: number;
        hasAuditLog: number;
        hasApplications: number;
      }>(connectionId, detectSql);

      const detection = result.recordset[0];
      if (!detection || !detection.hasSchema || !detection.hasEntityTable) {
        return { isMJEnabled: false };
      }

      // MJ is detected - get additional info
      const countsSql = `
        USE [${db}];
        SELECT
          (SELECT COUNT(*) FROM [${mj}].[Entity]) AS entityCount,
          (SELECT COUNT(*) FROM [${mj}].[Application]) AS applicationCount
      `;

      const countsResult = await this.poolManager.query<{
        entityCount: number;
        applicationCount: number;
      }>(connectionId, countsSql);

      const counts = countsResult.recordset[0] || { entityCount: 0, applicationCount: 0 };

      // Try to get version from VersionInstallation if it exists
      let version: string | undefined;
      try {
        const versionSql = `
          USE [${db}];
          IF OBJECT_ID('${mjStr}.VersionInstallation') IS NOT NULL
            SELECT TOP 1 MJVersion as version FROM [${mj}].[VersionInstallation]
            ORDER BY InstalledAt DESC
        `;
        const versionResult = await this.poolManager.query<{ version: string }>(
          connectionId,
          versionSql
        );
        version = versionResult.recordset[0]?.version;
      } catch {
        // Version table may not exist in older MJ versions
      }

      return {
        isMJEnabled: true,
        schemaName: mjSchemaName,
        version,
        entityCount: counts.entityCount,
        applicationCount: counts.applicationCount,
        hasUsers: Boolean(detection.hasUsers),
        hasAuditLog: Boolean(detection.hasAuditLog),
      };
    } catch (error) {
      log.error('Error detecting MJ database:', error);
      return { isMJEnabled: false };
    }
  }

  /**
   * Get MJ entities from a database
   */
  async getMJEntities(
    connectionId: string,
    database: string,
    mjSchemaName = '__mj'
  ): Promise<MJEntityInfo[]> {
    const db = this.escId(database);
    const mj = this.escId(mjSchemaName);
    const sql = `
      USE [${db}];
      SELECT
        CAST(ID AS NVARCHAR(36)) AS id,
        Name AS name,
        Description AS description,
        BaseTable AS baseTable,
        BaseView AS baseView,
        SchemaName AS schemaName,
        CAST(VirtualEntity AS BIT) AS isVirtual,
        CAST(TrackRecordChanges AS BIT) AS trackRecordChanges,
        CAST(AuditRecordAccess AS BIT) AS auditRecordAccess,
        CAST(IncludeInAPI AS BIT) AS includeInAPI,
        CAST(AllowCreateAPI AS BIT) AS allowCreateAPI,
        CAST(AllowUpdateAPI AS BIT) AS allowUpdateAPI,
        CAST(AllowDeleteAPI AS BIT) AS allowDeleteAPI,
        CONVERT(VARCHAR(30), __mj_CreatedAt, 126) AS createdAt,
        CONVERT(VARCHAR(30), __mj_UpdatedAt, 126) AS updatedAt
      FROM [${mj}].[Entity]
      ORDER BY Name
    `;

    const result = await this.poolManager.query<MJEntityInfo>(connectionId, sql);
    return result.recordset.map(row => ({
      ...row,
      isVirtual: Boolean(row.isVirtual),
      trackRecordChanges: Boolean(row.trackRecordChanges),
      auditRecordAccess: Boolean(row.auditRecordAccess),
      includeInAPI: Boolean(row.includeInAPI),
      allowCreateAPI: Boolean(row.allowCreateAPI),
      allowUpdateAPI: Boolean(row.allowUpdateAPI),
      allowDeleteAPI: Boolean(row.allowDeleteAPI),
    }));
  }

  /**
   * Get MJ entity fields for a specific entity
   */
  async getMJEntityFields(
    connectionId: string,
    database: string,
    entityId: string,
    mjSchemaName = '__mj'
  ): Promise<MJEntityFieldInfo[]> {
    const db = this.escId(database);
    const mj = this.escId(mjSchemaName);
    const sql = `
      USE [${db}];
      SELECT
        CAST(ID AS NVARCHAR(36)) AS id,
        CAST(EntityID AS NVARCHAR(36)) AS entityId,
        Name AS name,
        DisplayName AS displayName,
        Description AS description,
        Type AS type,
        Length AS length,
        Precision AS precision,
        Scale AS scale,
        CAST(AllowsNull AS BIT) AS allowsNull,
        CAST(IsPrimaryKey AS BIT) AS isPrimaryKey,
        CAST(IsUnique AS BIT) AS isUnique,
        DefaultValue AS defaultValue,
        CAST(IsVirtual AS BIT) AS isVirtual,
        Sequence AS sequence,
        CAST(RelatedEntityID AS NVARCHAR(36)) AS relatedEntityId,
        RelatedEntityFieldName AS relatedEntityFieldName
      FROM [${mj}].[EntityField]
      WHERE EntityID = '${this.escStr(entityId)}'
      ORDER BY Sequence
    `;

    const result = await this.poolManager.query<MJEntityFieldInfo>(connectionId, sql);
    return result.recordset.map(row => ({
      ...row,
      allowsNull: Boolean(row.allowsNull),
      isPrimaryKey: Boolean(row.isPrimaryKey),
      isUnique: Boolean(row.isUnique),
      isVirtual: Boolean(row.isVirtual),
    }));
  }

  /**
   * Get MJ applications from a database
   */
  async getMJApplications(
    connectionId: string,
    database: string,
    mjSchemaName = '__mj'
  ): Promise<MJApplicationInfo[]> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const sql = `
        USE [${db}];
        SELECT
          CAST(ID AS NVARCHAR(36)) AS id,
          Name AS name,
          Description AS description,
          Icon AS icon
        FROM [${mj}].[Application]
        ORDER BY Name
      `;

      const result = await this.poolManager.query<MJApplicationInfo>(connectionId, sql);
      return result.recordset;
    } catch (error) {
      log.error('getMJApplications:', error);
      return [];
    }
  }

  /**
   * Get MJ entity relationships
   */
  async getMJEntityRelationships(
    connectionId: string,
    database: string,
    entityId?: string,
    mjSchemaName = '__mj'
  ): Promise<MJEntityRelationship[]> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const whereClause = entityId ? `WHERE er.EntityID = '${this.escStr(entityId)}'` : '';
      const sql = `
        USE [${db}];
        SELECT
          CAST(er.ID AS NVARCHAR(36)) AS id,
          CAST(er.EntityID AS NVARCHAR(36)) AS entityId,
          e1.Name AS entityName,
          CAST(er.RelatedEntityID AS NVARCHAR(36)) AS relatedEntityId,
          e2.Name AS relatedEntityName,
          CAST(er.BundleInAPI AS BIT) AS bundleInAPI,
          er.Type AS type,
          er.DisplayName AS displayName,
          CAST(er.DisplayInForm AS BIT) AS displayInForm,
          er.DisplayLocation AS displayLocation,
          er.Sequence AS sequence
        FROM [${mj}].[EntityRelationship] er
        JOIN [${mj}].[Entity] e1 ON er.EntityID = e1.ID
        JOIN [${mj}].[Entity] e2 ON er.RelatedEntityID = e2.ID
        ${whereClause}
        ORDER BY er.Sequence
      `;

      const result = await this.poolManager.query<MJEntityRelationship>(connectionId, sql);
      return result.recordset.map(row => ({
        ...row,
        bundleInAPI: Boolean(row.bundleInAPI),
        displayInForm: Boolean(row.displayInForm),
      }));
    } catch (error) {
      log.error('getMJEntityRelationships:', error);
      return [];
    }
  }

  /**
   * Get MJ record changes (audit trail for data modifications)
   */
  async getMJRecordChanges(
    connectionId: string,
    database: string,
    options: {
      entityId?: string;
      entityName?: string;
      recordId?: string;
      limit?: number;
    } = {},
    mjSchemaName = '__mj'
  ): Promise<MJRecordChange[]> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const conditions: string[] = [];
      if (options.entityId) conditions.push(`rc.EntityID = '${this.escStr(options.entityId)}'`);
      if (options.entityName) conditions.push(`e.Name = '${this.escStr(options.entityName)}'`);
      if (options.recordId) conditions.push(`rc.RecordID = '${this.escStr(options.recordId)}'`);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(options.limit || 100, 10000));

      const sql = `
        USE [${db}];
        SELECT TOP ${limit}
          CAST(rc.ID AS NVARCHAR(36)) AS id,
          CAST(rc.EntityID AS NVARCHAR(36)) AS entityId,
          e.Name AS entityName,
          rc.RecordID AS recordId,
          rc.Type AS type,
          rc.Source AS source,
          rc.ChangesJSON AS changesJSON,
          rc.ChangesDescription AS changesDescription,
          rc.FullRecordJSON AS fullRecordJSON,
          rc.Status AS status,
          rc.Comments AS comments,
          CONVERT(VARCHAR(30), rc.__mj_CreatedAt, 126) AS createdAt,
          CAST(rc.UserID AS NVARCHAR(36)) AS userId,
          u.Name AS userName
        FROM [${mj}].[RecordChange] rc
        LEFT JOIN [${mj}].[Entity] e ON rc.EntityID = e.ID
        LEFT JOIN [${mj}].[User] u ON rc.UserID = u.ID
        ${whereClause}
        ORDER BY rc.__mj_CreatedAt DESC
      `;

      const result = await this.poolManager.query<MJRecordChange>(connectionId, sql);
      return result.recordset;
    } catch (error) {
      log.error('getMJRecordChanges:', error);
      return [];
    }
  }

  /**
   * Get MJ audit logs
   */
  async getMJAuditLogs(
    connectionId: string,
    database: string,
    options: {
      entityId?: string;
      recordId?: string;
      userId?: string;
      limit?: number;
    } = {},
    mjSchemaName = '__mj'
  ): Promise<MJAuditLog[]> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const conditions: string[] = [];
      if (options.entityId) conditions.push(`al.EntityID = '${this.escStr(options.entityId)}'`);
      if (options.recordId) conditions.push(`al.RecordID = '${this.escStr(options.recordId)}'`);
      if (options.userId) conditions.push(`al.UserID = '${this.escStr(options.userId)}'`);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(options.limit || 100, 10000));

      const sql = `
        USE [${db}];
        SELECT TOP ${limit}
          CAST(al.ID AS NVARCHAR(36)) AS id,
          CAST(al.UserID AS NVARCHAR(36)) AS userId,
          u.Name AS userName,
          alt.Name AS auditLogTypeName,
          al.Status AS status,
          CAST(al.EntityID AS NVARCHAR(36)) AS entityId,
          e.Name AS entityName,
          al.RecordID AS recordId,
          al.Description AS description,
          al.Details AS details,
          CONVERT(VARCHAR(30), al.__mj_CreatedAt, 126) AS createdAt
        FROM [${mj}].[AuditLog] al
        LEFT JOIN [${mj}].[User] u ON al.UserID = u.ID
        LEFT JOIN [${mj}].[AuditLogType] alt ON al.AuditLogTypeID = alt.ID
        LEFT JOIN [${mj}].[Entity] e ON al.EntityID = e.ID
        ${whereClause}
        ORDER BY al.__mj_CreatedAt DESC
      `;

      const result = await this.poolManager.query<MJAuditLog>(connectionId, sql);
      return result.recordset;
    } catch (error) {
      log.error('getMJAuditLogs:', error);
      return [];
    }
  }

  /**
   * Get MJ saved queries
   */
  async getMJSavedQueries(
    connectionId: string,
    database: string,
    categoryId?: string,
    mjSchemaName = '__mj'
  ): Promise<MJQuery[]> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const whereClause = categoryId ? `WHERE q.CategoryID = '${this.escStr(categoryId)}'` : '';
      const sql = `
        USE [${db}];
        SELECT
          CAST(q.ID AS NVARCHAR(36)) AS id,
          q.Name AS name,
          q.Description AS description,
          CAST(q.CategoryID AS NVARCHAR(36)) AS categoryId,
          qc.Name AS categoryName,
          q.SQL AS sql,
          q.OriginalSQL AS originalSQL,
          q.Feedback AS feedback,
          q.Status AS status,
          q.QualityRank AS qualityRank,
          CONVERT(VARCHAR(30), q.__mj_CreatedAt, 126) AS createdAt,
          CONVERT(VARCHAR(30), q.__mj_UpdatedAt, 126) AS updatedAt
        FROM [${mj}].[Query] q
        LEFT JOIN [${mj}].[QueryCategory] qc ON q.CategoryID = qc.ID
        ${whereClause}
        ORDER BY q.Name
      `;

      const result = await this.poolManager.query<MJQuery>(connectionId, sql);
      return result.recordset;
    } catch (error) {
      log.error('getMJSavedQueries:', error);
      return [];
    }
  }

  /**
   * Get MJ error logs
   */
  async getMJErrorLogs(
    connectionId: string,
    database: string,
    options: { category?: string; limit?: number } = {},
    mjSchemaName = '__mj'
  ): Promise<MJErrorLog[]> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const conditions: string[] = [];
      if (options.category) conditions.push(`Category = '${this.escStr(options.category)}'`);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(options.limit || 100, 10000));

      const sql = `
        USE [${db}];
        SELECT TOP ${limit}
          CAST(ID AS NVARCHAR(36)) AS id,
          Code AS code,
          Message AS message,
          Category AS category,
          Status AS status,
          Details AS details,
          CreatedBy AS createdBy,
          CONVERT(VARCHAR(30), __mj_CreatedAt, 126) AS createdAt
        FROM [${mj}].[ErrorLog]
        ${whereClause}
        ORDER BY __mj_CreatedAt DESC
      `;

      const result = await this.poolManager.query<MJErrorLog>(connectionId, sql);
      return result.recordset;
    } catch (error) {
      log.error('getMJErrorLogs:', error);
      return [];
    }
  }

  /**
   * Get MJ user record access logs
   */
  async getMJUserRecordLogs(
    connectionId: string,
    database: string,
    options: {
      entityId?: string;
      recordId?: string;
      userId?: string;
      limit?: number;
    } = {},
    mjSchemaName = '__mj'
  ): Promise<MJUserRecordLog[]> {
    try {
      const db = this.escId(database);
      const mj = this.escId(mjSchemaName);
      const conditions: string[] = [];
      if (options.entityId) conditions.push(`url.EntityID = '${this.escStr(options.entityId)}'`);
      if (options.recordId) conditions.push(`url.RecordID = '${this.escStr(options.recordId)}'`);
      if (options.userId) conditions.push(`url.UserID = '${this.escStr(options.userId)}'`);
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(options.limit || 100, 10000));

      const sql = `
        USE [${db}];
        SELECT TOP ${limit}
          CAST(url.ID AS NVARCHAR(36)) AS id,
          CAST(url.UserID AS NVARCHAR(36)) AS userId,
          u.Name AS userName,
          CAST(url.EntityID AS NVARCHAR(36)) AS entityId,
          e.Name AS entityName,
          url.RecordID AS recordId,
          CONVERT(VARCHAR(30), url.EarliestAt, 126) AS earliestAt,
          CONVERT(VARCHAR(30), url.LatestAt, 126) AS latestAt,
          url.TotalCount AS totalCount
        FROM [${mj}].[UserRecordLog] url
        LEFT JOIN [${mj}].[User] u ON url.UserID = u.ID
        LEFT JOIN [${mj}].[Entity] e ON url.EntityID = e.ID
        ${whereClause}
        ORDER BY url.LatestAt DESC
      `;

      const result = await this.poolManager.query<MJUserRecordLog>(connectionId, sql);
      return result.recordset;
    } catch (error) {
      log.error('getMJUserRecordLogs:', error);
      return [];
    }
  }

  /**
   * Invalidate all caches for a connection
   */
  invalidateConnection(connectionId: string): void {
    this.databaseCache.invalidatePrefix(`databases:${connectionId}`);
    this.tableCache.invalidatePrefix(`tables:${connectionId}`);
    this.viewCache.invalidatePrefix(`views:${connectionId}`);
    this.procedureCache.invalidatePrefix(`procedures:${connectionId}`);
    this.functionCache.invalidatePrefix(`functions:${connectionId}`);
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
