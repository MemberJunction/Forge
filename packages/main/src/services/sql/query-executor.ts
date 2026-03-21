/**
 * Query Executor Service
 * Executes SQL queries and returns structured results
 */

import { v4 as uuidv4 } from 'uuid';
import type * as mssql from 'mssql';
import type { QueryRequest, QueryResult, ResultSet, ColumnMetadata } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { ConnectionPoolManager } from './connection-pool';
import { MetadataService } from './metadata';

interface ParsedTableRef {
  schema: string;
  table: string;
}

interface ActiveQuery {
  queryId: string;
  connectionId: string;
  startTime: number;
  cancelled: boolean;
  request?: mssql.Request; // Track the actual request for cancellation
}

export class QueryExecutor extends BaseSingleton {
  private poolManager: ConnectionPoolManager;
  private metadataService: MetadataService;
  private activeQueries: Map<string, ActiveQuery> = new Map();

  constructor() {
    super();
    this.poolManager = ConnectionPoolManager.getInstance();
    this.metadataService = MetadataService.getInstance();
  }

  /**
   * Execute a SQL query
   */
  async execute(request: QueryRequest): Promise<QueryResult> {
    const queryId = request.queryId || uuidv4();
    const startTime = Date.now();

    // Track active query
    const activeQuery: ActiveQuery = {
      queryId,
      connectionId: request.connectionId,
      startTime,
      cancelled: false,
    };
    this.activeQueries.set(queryId, activeQuery);

    try {
      const pool = await this.poolManager.getPool(request.connectionId);
      const sqlRequest = pool.request();

      // Store the request object for cancellation
      activeQuery.request = sqlRequest;

      // Check if cancelled before executing
      if (activeQuery.cancelled) {
        return this.createCancelledResult(queryId, startTime);
      }

      // Prepend USE [database] to the SQL and execute as a raw batch.
      // We use batch() instead of query() because query() uses sp_executesql
      // which doesn't support USE statements. batch() sends raw T-SQL.
      let sql = request.sql;
      if (request.database) {
        const safeDb = request.database.replace(/\]/g, ']]');
        sql = `USE [${safeDb}];\n${sql}`;
      }

      // Execute as a batch (raw T-SQL) to support USE and other batch commands
      const result = await sqlRequest.batch(sql);

      // Check if cancelled
      if (activeQuery.cancelled) {
        return this.createCancelledResult(queryId, startTime);
      }

      // Process result sets
      const resultSets: ResultSet[] = [];
      const messages: string[] = [];

      // Try to parse the SQL to detect a single-table SELECT for FK enrichment
      const parsedTable = this.parseSimpleSelect(request.sql);
      let enrichedColumns: Map<string, ColumnMetadata> | null = null;

      if (parsedTable && request.database) {
        try {
          const metadata = await this.metadataService.getEnrichedColumnMetadata(
            request.connectionId,
            request.database,
            parsedTable.schema,
            parsedTable.table
          );
          enrichedColumns = new Map(
            metadata.map(col => [
              col.name.toLowerCase(),
              {
                name: col.name,
                type: col.type,
                dataType: col.type,
                nullable: col.nullable,
                maxLength: col.maxLength ?? undefined,
                precision: col.precision ?? undefined,
                scale: col.scale ?? undefined,
                isPrimaryKey: col.isPrimaryKey,
                foreignKey: col.foreignKey ?? undefined,
              },
            ])
          );
        } catch {
          // Ignore metadata errors - just proceed without FK info
        }
      }

      // Handle multiple result sets
      if (Array.isArray(result.recordsets)) {
        for (let i = 0; i < result.recordsets.length; i++) {
          const recordset = result.recordsets[i];
          let columns = this.extractColumns(recordset.columns);

          // Enrich columns with FK metadata if available
          if (enrichedColumns) {
            columns = columns.map(col => {
              const enriched = enrichedColumns!.get(col.name.toLowerCase());
              if (enriched) {
                return {
                  ...col,
                  isPrimaryKey: enriched.isPrimaryKey,
                  foreignKey: enriched.foreignKey,
                };
              }
              return col;
            });
          }

          resultSets.push({
            columns,
            rows: recordset as unknown as Record<string, unknown>[],
            rowCount: recordset.length,
          });
        }
      }

      // Add row count message
      const rowsAffected = result.rowsAffected?.reduce((a, b) => a + b, 0) || 0;
      messages.push(`(${rowsAffected} row(s) affected)`);

      return {
        queryId,
        success: true,
        resultSets,
        messages,
        rowsAffected,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      const err = error as Error & { lineNumber?: number; number?: number };

      return {
        queryId,
        success: false,
        resultSets: [],
        messages: [err.message],
        rowsAffected: 0,
        executionTime: Date.now() - startTime,
        error: err.message,
      };
    } finally {
      this.activeQueries.delete(queryId);
    }
  }

  /**
   * Cancel a running query
   */
  async cancel(queryId: string): Promise<boolean> {
    const activeQuery = this.activeQueries.get(queryId);
    if (activeQuery) {
      activeQuery.cancelled = true;

      // Actually cancel the mssql request if it exists
      if (activeQuery.request) {
        try {
          activeQuery.request.cancel();
          console.log(`Query ${queryId} cancelled successfully`);
          return true;
        } catch (error) {
          console.error(`Error cancelling query ${queryId}:`, error);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * Extract column metadata from a recordset
   */
  private extractColumns(columns: Record<string, unknown>): ColumnMetadata[] {
    if (!columns) {
      return [];
    }

    return Object.entries(columns).map(([name, info]) => {
      const col = info as {
        type?: { declaration: string };
        nullable?: boolean;
        length?: number;
        precision?: number;
        scale?: number;
      };

      return {
        name,
        type: col.type?.declaration || 'unknown',
        dataType: col.type?.declaration || 'unknown',
        nullable: col.nullable ?? true,
        maxLength: col.length,
        precision: col.precision,
        scale: col.scale,
      };
    });
  }

  /**
   * Create a result for a cancelled query
   */
  private createCancelledResult(queryId: string, startTime: number): QueryResult {
    return {
      queryId,
      success: false,
      resultSets: [],
      messages: ['Query was cancelled'],
      rowsAffected: 0,
      executionTime: Date.now() - startTime,
      error: 'Query cancelled by user',
    };
  }

  /**
   * Parse a simple SELECT statement to extract the source table
   * Returns schema and table name if it's a single-table SELECT, null otherwise
   *
   * Matches patterns like:
   * - SELECT * FROM [schema].[table]
   * - SELECT * FROM schema.table
   * - SELECT * FROM [table]
   * - SELECT TOP n * FROM ...
   */
  private parseSimpleSelect(sql: string): ParsedTableRef | null {
    // Normalize whitespace and remove comments
    const normalized = sql
      .replace(/--.*$/gm, '') // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/\s+/g, ' ')
      .trim();

    // Match SELECT ... FROM [schema].[table] or SELECT ... FROM schema.table
    // The regex captures the table reference after FROM
    // Support: [schema].[table], schema.table, [table], table
    const fromMatch = normalized.match(
      /^\s*SELECT\s+(?:TOP\s+\d+\s+)?(?:DISTINCT\s+)?(?:\*|[\w\s,[\].*]+)\s+FROM\s+(\[?[\w]+\]?(?:\.\[?[\w]+\]?)?)/i
    );

    if (!fromMatch) {
      return null;
    }

    // Check for JOINs or multiple tables - if found, we can't reliably determine the source
    if (
      /\bJOIN\b/i.test(normalized) ||
      /,\s*\[?[\w]+\]?(?:\.\[?[\w]+\]?)?\s+(?:AS\s+)?[\w]/i.test(
        normalized.substring(normalized.indexOf('FROM'))
      )
    ) {
      return null;
    }

    const tableRef = fromMatch[1];

    // Parse the table reference
    // Patterns: [schema].[table], schema.table, [schema].table, schema.[table], [table], table
    const parts = tableRef.split('.');

    if (parts.length === 1) {
      // Just table name, assume dbo schema
      const table = parts[0].replace(/^\[|\]$/g, '');
      return { schema: 'dbo', table };
    } else if (parts.length === 2) {
      // schema.table
      const schema = parts[0].replace(/^\[|\]$/g, '');
      const table = parts[1].replace(/^\[|\]$/g, '');
      return { schema, table };
    }

    return null;
  }
}
