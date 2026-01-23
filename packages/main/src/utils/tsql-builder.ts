/**
 * T-SQL Builder - Generates safe T-SQL statements
 */

import type {
  CreateDatabaseOptions,
  RenameDatabaseOptions,
  DeleteDatabaseOptions,
  BackupType,
} from '@mj-forge/shared';

/**
 * Internal options for backup T-SQL generation (no connectionId needed)
 */
export interface BackupTsqlOptions {
  databaseName: string;
  destinationPath: string;
  backupType: BackupType | 'full_copy_only';
  compression: boolean;
  verify: boolean;
  description?: string;
}

/**
 * Internal options for restore T-SQL generation (no connectionId needed)
 */
export interface RestoreTsqlOptions {
  sourcePath: string;
  targetDatabaseName: string;
  overwriteExisting: boolean;
  fileMoves: Array<{ logicalName: string; destinationPath: string }>;
  recoveryState: 'recovery' | 'norecovery' | 'standby';
}

export class TsqlBuilder {
  /**
   * Safely escape a SQL identifier (database name, table name, etc.)
   * In SQL Server, only ] needs to be escaped (as ]]) inside brackets
   */
  static escapeIdentifier(name: string): string {
    const cleaned = name.replace(/\]/g, ']]');
    return `[${cleaned}]`;
  }

  /**
   * Safely escape a string literal (escapes quotes, caller adds delimiters)
   */
  static escapeString(value: string): string {
    return value.replace(/'/g, "''");
  }

  /**
   * Generate CREATE DATABASE statement
   */
  static createDatabase(options: CreateDatabaseOptions): string {
    const name = this.escapeIdentifier(options.name);
    let sql = `CREATE DATABASE ${name}`;

    if (options.collation) {
      sql += `\nCOLLATE ${options.collation}`;
    }

    sql += ';';

    if (options.recoveryModel && options.recoveryModel !== 'full') {
      sql += `\n\nALTER DATABASE ${name}\nSET RECOVERY ${options.recoveryModel.toUpperCase()};`;
    }

    return sql;
  }

  /**
   * Generate ALTER DATABASE ... MODIFY NAME statement
   */
  static renameDatabase(options: RenameDatabaseOptions): string {
    const current = this.escapeIdentifier(options.currentName);
    const next = this.escapeIdentifier(options.newName);

    let sql = '';

    if (options.closeConnections) {
      sql += `ALTER DATABASE ${current}\nSET SINGLE_USER WITH ROLLBACK IMMEDIATE;\n\n`;
    }

    sql += `ALTER DATABASE ${current}\nMODIFY NAME = ${next};\n\n`;
    sql += `ALTER DATABASE ${next}\nSET MULTI_USER;`;

    return sql;
  }

  /**
   * Generate DROP DATABASE statement
   */
  static dropDatabase(options: DeleteDatabaseOptions): string {
    const escaped = this.escapeIdentifier(options.name);

    let sql = '';

    if (options.closeConnections) {
      sql += `ALTER DATABASE ${escaped}\nSET SINGLE_USER WITH ROLLBACK IMMEDIATE;\n\n`;
    }

    sql += `DROP DATABASE ${escaped};`;

    return sql;
  }

  /**
   * Alias for dropDatabase to match DeleteDatabaseOptions naming
   */
  static deleteDatabase(options: DeleteDatabaseOptions): string {
    return this.dropDatabase(options);
  }

  /**
   * Generate BACKUP DATABASE statement
   */
  static backup(options: BackupTsqlOptions): string {
    const dbName = this.escapeIdentifier(options.databaseName);
    const path = this.escapeString(options.destinationPath);

    let sql = `BACKUP DATABASE ${dbName}\nTO DISK = N'${path}'\nWITH`;

    const withOptions: string[] = [];

    if (options.backupType === 'full_copy_only') {
      withOptions.push('COPY_ONLY');
    } else if (options.backupType === 'differential') {
      withOptions.push('DIFFERENTIAL');
    }

    withOptions.push('INIT'); // Overwrite existing file

    if (options.compression) {
      withOptions.push('COMPRESSION');
    }

    if (options.description) {
      withOptions.push(`DESCRIPTION = N'${this.escapeString(options.description)}'`);
    }

    withOptions.push('STATS = 5'); // Report progress every 5%

    sql += ' ' + withOptions.join(', ') + ';';

    return sql;
  }

  /**
   * Generate RESTORE DATABASE statement
   */
  static restore(options: RestoreTsqlOptions): string {
    const dbName = this.escapeIdentifier(options.targetDatabaseName);
    const path = this.escapeString(options.sourcePath);

    let sql = `RESTORE DATABASE ${dbName}\nFROM DISK = N'${path}'\nWITH`;

    const withOptions: string[] = [];

    // File moves
    for (const move of options.fileMoves) {
      const logical = this.escapeString(move.logicalName);
      const dest = this.escapeString(move.destinationPath);
      withOptions.push(`MOVE N'${logical}' TO N'${dest}'`);
    }

    if (options.overwriteExisting) {
      withOptions.push('REPLACE');
    }

    // Recovery state
    if (options.recoveryState === 'norecovery') {
      withOptions.push('NORECOVERY');
    } else if (options.recoveryState === 'standby') {
      withOptions.push("STANDBY = N'standby.dat'");
    } else {
      withOptions.push('RECOVERY');
    }

    withOptions.push('STATS = 5');

    sql += '\n    ' + withOptions.join(',\n    ') + ';';

    return sql;
  }

  /**
   * Generate RESTORE FILELISTONLY statement
   */
  static getBackupFileInfo(path: string): string {
    const escaped = this.escapeString(path);
    return `RESTORE FILELISTONLY FROM DISK = N'${escaped}';`;
  }

  /**
   * Generate RESTORE HEADERONLY statement
   */
  static getBackupHeaderInfo(path: string): string {
    const escaped = this.escapeString(path);
    return `RESTORE HEADERONLY FROM DISK = N'${escaped}';`;
  }

  /**
   * Generate query to list databases
   */
  static listDatabases(): string {
    return `
SELECT
  d.name,
  d.database_id as databaseId,
  COALESCE(SUM(CAST(f.size AS BIGINT)) * 8 * 1024, 0) as sizeBytes,
  d.state_desc as state,
  d.recovery_model_desc as recoveryModel,
  d.collation_name as collation,
  d.compatibility_level as compatibilityLevel,
  CASE WHEN d.database_id <= 4 THEN 1 ELSE 0 END as isSystemDb,
  d.create_date as createdAt,
  (SELECT MAX(backup_finish_date) FROM msdb.dbo.backupset WHERE database_name = d.name AND type = 'D') as lastBackupDate,
  (SELECT MAX(backup_finish_date) FROM msdb.dbo.backupset WHERE database_name = d.name AND type = 'L') as lastLogBackupDate
FROM sys.databases d
LEFT JOIN sys.master_files f ON d.database_id = f.database_id
GROUP BY d.name, d.database_id, d.state_desc, d.recovery_model_desc,
         d.collation_name, d.compatibility_level, d.create_date
ORDER BY d.name;`;
  }

  /**
   * Generate query to list tables
   */
  static listTables(database: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  s.name as [schema],
  t.name as name,
  ISNULL(p.rows, 0) as [rowCount],
  ISNULL(SUM(CAST(a.total_pages AS BIGINT)) * 8, 0) as sizeKb,
  t.create_date as createdAt
FROM sys.tables t
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
LEFT JOIN sys.allocation_units a ON p.partition_id = a.container_id
GROUP BY s.name, t.name, p.rows, t.create_date
ORDER BY s.name, t.name;`;
  }

  /**
   * Generate query to list views
   */
  static listViews(database: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  s.name as [schema],
  v.name as name,
  v.create_date as createdAt
FROM sys.views v
INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
ORDER BY s.name, v.name;`;
  }

  /**
   * Generate query to list stored procedures
   */
  static listProcedures(database: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  s.name as [schema],
  p.name as name,
  p.create_date as createdAt,
  p.modify_date as modifiedAt
FROM sys.procedures p
INNER JOIN sys.schemas s ON p.schema_id = s.schema_id
WHERE p.is_ms_shipped = 0
ORDER BY s.name, p.name;`;
  }

  /**
   * Generate query to get object definition
   */
  static getObjectDefinition(database: string, schema: string, name: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT OBJECT_DEFINITION(OBJECT_ID('${this.escapeString(schema)}.${this.escapeString(name)}')) as definition;`;
  }

  /**
   * Generate query to list columns for a table
   */
  static listColumns(database: string, schema: string, table: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  c.name,
  t.name as dataType,
  c.max_length as maxLength,
  c.precision,
  c.scale,
  c.is_nullable as isNullable,
  CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END as isPrimaryKey,
  CASE WHEN fk.parent_column_id IS NOT NULL THEN 1 ELSE 0 END as isForeignKey,
  dc.definition as defaultValue,
  c.column_id as ordinalPosition
FROM sys.columns c
INNER JOIN sys.types t ON c.user_type_id = t.user_type_id
INNER JOIN sys.objects o ON c.object_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
LEFT JOIN (
  SELECT ic.column_id, ic.object_id
  FROM sys.index_columns ic
  INNER JOIN sys.indexes i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  WHERE i.is_primary_key = 1
) pk ON c.object_id = pk.object_id AND c.column_id = pk.column_id
LEFT JOIN sys.foreign_key_columns fk ON c.object_id = fk.parent_object_id AND c.column_id = fk.parent_column_id
WHERE s.name = '${this.escapeString(schema)}'
  AND o.name = '${this.escapeString(table)}'
ORDER BY c.column_id;`;
  }

  /**
   * Generate query to list indexes for a table
   */
  static listIndexes(database: string, schema: string, table: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  i.name,
  CASE i.type
    WHEN 1 THEN 'clustered'
    WHEN 2 THEN 'nonclustered'
    WHEN 3 THEN 'xml'
    WHEN 4 THEN 'spatial'
    ELSE 'nonclustered'
  END as type,
  i.is_unique as isUnique,
  i.is_primary_key as isPrimaryKey,
  STUFF((
    SELECT ', ' + c.name
    FROM sys.index_columns ic
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
    ORDER BY ic.key_ordinal
    FOR XML PATH('')
  ), 1, 2, '') as columns
FROM sys.indexes i
INNER JOIN sys.objects o ON i.object_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
  AND o.name = '${this.escapeString(table)}'
  AND i.name IS NOT NULL
ORDER BY i.is_primary_key DESC, i.name;`;
  }

  /**
   * Generate query to list foreign keys for a table
   */
  static listForeignKeys(database: string, schema: string, table: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  fk.name,
  STUFF((
    SELECT ', ' + c.name
    FROM sys.foreign_key_columns fkc
    INNER JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
    WHERE fkc.constraint_object_id = fk.object_id
    ORDER BY fkc.constraint_column_id
    FOR XML PATH('')
  ), 1, 2, '') as columns,
  rs.name as referencedSchema,
  OBJECT_NAME(fk.referenced_object_id) as referencedTable,
  STUFF((
    SELECT ', ' + c.name
    FROM sys.foreign_key_columns fkc
    INNER JOIN sys.columns c ON fkc.referenced_object_id = c.object_id AND fkc.referenced_column_id = c.column_id
    WHERE fkc.constraint_object_id = fk.object_id
    ORDER BY fkc.constraint_column_id
    FOR XML PATH('')
  ), 1, 2, '') as referencedColumns,
  CASE fk.delete_referential_action
    WHEN 0 THEN 'no_action'
    WHEN 1 THEN 'cascade'
    WHEN 2 THEN 'set_null'
    WHEN 3 THEN 'set_default'
  END as onDelete,
  CASE fk.update_referential_action
    WHEN 0 THEN 'no_action'
    WHEN 1 THEN 'cascade'
    WHEN 2 THEN 'set_null'
    WHEN 3 THEN 'set_default'
  END as onUpdate
FROM sys.foreign_keys fk
INNER JOIN sys.objects o ON fk.parent_object_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
INNER JOIN sys.schemas rs ON fk.schema_id = rs.schema_id
WHERE s.name = '${this.escapeString(schema)}'
  AND o.name = '${this.escapeString(table)}'
ORDER BY fk.name;`;
  }

  /**
   * Generate query to list constraints for a table
   */
  static listConstraints(database: string, schema: string, table: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  kc.name,
  CASE kc.type
    WHEN 'PK' THEN 'primary_key'
    WHEN 'UQ' THEN 'unique'
  END as type,
  STUFF((
    SELECT ', ' + c.name
    FROM sys.index_columns ic
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
    ORDER BY ic.key_ordinal
    FOR XML PATH('')
  ), 1, 2, '') as columns,
  NULL as definition
FROM sys.key_constraints kc
INNER JOIN sys.objects o ON kc.parent_object_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
  AND o.name = '${this.escapeString(table)}'

UNION ALL

SELECT
  cc.name,
  'check' as type,
  NULL as columns,
  cc.definition
FROM sys.check_constraints cc
INNER JOIN sys.objects o ON cc.parent_object_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
  AND o.name = '${this.escapeString(table)}'

UNION ALL

SELECT
  dc.name,
  'default' as type,
  c.name as columns,
  dc.definition
FROM sys.default_constraints dc
INNER JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
INNER JOIN sys.objects o ON dc.parent_object_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
  AND o.name = '${this.escapeString(table)}'

ORDER BY type, name;`;
  }

  /**
   * Generate query to list triggers for a table
   */
  static listTriggers(database: string, schema: string, table: string): string {
    return `
USE ${this.escapeIdentifier(database)};
SELECT
  t.name,
  t.is_disabled as isDisabled,
  CASE
    WHEN t.is_instead_of_trigger = 1 THEN 'instead_of'
    WHEN EXISTS(SELECT 1 FROM sys.trigger_events te WHERE te.object_id = t.object_id AND te.type = 1) THEN 'insert'
    WHEN EXISTS(SELECT 1 FROM sys.trigger_events te WHERE te.object_id = t.object_id AND te.type = 2) THEN 'update'
    WHEN EXISTS(SELECT 1 FROM sys.trigger_events te WHERE te.object_id = t.object_id AND te.type = 3) THEN 'delete'
    ELSE 'unknown'
  END as triggerType,
  t.create_date as createdAt
FROM sys.triggers t
INNER JOIN sys.objects o ON t.parent_id = o.object_id
INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE s.name = '${this.escapeString(schema)}'
  AND o.name = '${this.escapeString(table)}'
ORDER BY t.name;`;
  }
}
