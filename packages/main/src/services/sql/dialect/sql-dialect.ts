/**
 * SQL Dialect Abstraction
 *
 * Encapsulates all database-specific SQL syntax differences.
 * Each database engine (SQL Server, PostgreSQL, MySQL) provides
 * a concrete implementation. Follows the MemberJunction pattern:
 * see @memberjunction/sql-dialect for the upstream design.
 */

import type {
  DatabaseEngine,
  CreateDatabaseOptions,
  RenameDatabaseOptions,
  DeleteDatabaseOptions,
} from '@mj-forge/shared';

// Re-export engine type for convenience
export type { DatabaseEngine };

/** Result of quoting a schema-qualified identifier */
export interface QualifiedName {
  sql: string; // e.g. [dbo].[Users] or "public"."users"
}

/**
 * Abstract SQL dialect — subclassed per database engine.
 */
export abstract class SQLDialect {
  abstract readonly engine: DatabaseEngine;

  /** Display name for the engine (e.g. "SQL Server", "PostgreSQL") */
  abstract readonly label: string;

  /** Default port for the engine */
  abstract readonly defaultPort: number;

  /** Monaco editor language ID for syntax highlighting */
  abstract readonly monacoLanguage: string;

  // ── Identifier quoting ──────────────────────────────────────

  /** Quote a single identifier (table, column, schema name) */
  abstract quoteIdentifier(name: string): string;

  /** Quote a schema-qualified object: schema.object */
  quoteSchemaObject(schema: string, object: string): string {
    return `${this.quoteIdentifier(schema)}.${this.quoteIdentifier(object)}`;
  }

  /** Escape a string literal value (caller wraps in quotes) */
  escapeString(value: string): string {
    return value.replace(/'/g, "''");
  }

  // ── SQL generation helpers ──────────────────────────────────

  /** Statement to switch database context */
  abstract useDatabaseSQL(database: string): string;

  /** Batch separator (e.g. GO for T-SQL, none for PG/MySQL) */
  abstract readonly batchSeparator: string | null;

  // ── DDL: Databases ──────────────────────────────────────────

  abstract createDatabaseSQL(options: CreateDatabaseOptions): string;
  abstract renameDatabaseSQL(options: RenameDatabaseOptions): string;
  abstract dropDatabaseSQL(options: DeleteDatabaseOptions): string;

  // ── Metadata queries ────────────────────────────────────────

  abstract listDatabasesSQL(): string;
  abstract listSchemasSQL(database: string): string;
  abstract listTablesSQL(database: string, schema?: string): string;
  abstract listViewsSQL(database: string, schema?: string): string;
  abstract listProceduresSQL(database: string, schema?: string): string;
  abstract listFunctionsSQL(database: string, schema?: string): string;
  abstract listColumnsSQL(database: string, schema: string, table: string): string;
  abstract listIndexesSQL(database: string, schema: string, table: string): string;
  abstract listForeignKeysSQL(database: string, schema: string, table: string): string;
  abstract listConstraintsSQL(database: string, schema: string, table: string): string;
  abstract listTriggersSQL(database: string, schema: string, table: string): string;
  abstract getObjectDefinitionSQL(database: string, schema: string, name: string): string;

  // ── Syntax patterns ─────────────────────────────────────────

  /** Whether this dialect uses GO as a client-side batch separator */
  get supportsBatchSeparator(): boolean {
    return this.batchSeparator !== null;
  }

  /** Whether this dialect supports Windows/AD authentication */
  abstract readonly supportsWindowsAuth: boolean;

  /** Whether this dialect supports backup/restore commands */
  abstract readonly supportsBackupRestore: boolean;

  /** Whether this dialect has extended properties (SQL Server) or comments (PostgreSQL) */
  abstract readonly supportsExtendedProperties: boolean;

  /** Whether this dialect supports object comments (COMMENT ON for PG, extended properties for MSSQL) */
  abstract readonly supportsObjectComments: boolean;

  /**
   * Query to list comments/descriptions for a table and its columns.
   * Returns rows with: name, value, level2Type, level2Name (matching ExtendedProperty shape).
   * SQL Server: uses fn_listextendedproperty
   * PostgreSQL: uses pg_description + obj_description
   */
  abstract listObjectCommentsSQL(database: string, schema: string, table: string): string | null;

  /** Whether this dialect supports server-side file browsing (xp_dirtree etc.) */
  abstract readonly supportsServerFileBrowsing: boolean;
}
