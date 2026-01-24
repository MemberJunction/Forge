/**
 * Query Executor Service
 * Executes SQL queries and returns structured results
 */

import { v4 as uuidv4 } from 'uuid';
import type * as mssql from 'mssql';
import type { QueryRequest, QueryResult, ResultSet, ColumnMetadata } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { ConnectionPoolManager } from './connection-pool';

interface ActiveQuery {
  queryId: string;
  connectionId: string;
  startTime: number;
  cancelled: boolean;
  request?: mssql.Request; // Track the actual request for cancellation
}

export class QueryExecutor extends BaseSingleton {
  private poolManager: ConnectionPoolManager;
  private activeQueries: Map<string, ActiveQuery> = new Map();

  constructor() {
    super();
    this.poolManager = ConnectionPoolManager.getInstance();
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

      // Switch to the specified database
      if (request.database) {
        await sqlRequest.batch(`USE [${request.database.replace(/\]/g, ']]')}]`);
      }

      // Check if cancelled before executing
      if (activeQuery.cancelled) {
        return this.createCancelledResult(queryId, startTime);
      }

      // Execute the query
      const result = await sqlRequest.query(request.sql);

      // Check if cancelled
      if (activeQuery.cancelled) {
        return this.createCancelledResult(queryId, startTime);
      }

      // Process result sets
      const resultSets: ResultSet[] = [];
      const messages: string[] = [];

      // Handle multiple result sets
      if (Array.isArray(result.recordsets)) {
        for (let i = 0; i < result.recordsets.length; i++) {
          const recordset = result.recordsets[i];
          const columns = this.extractColumns(recordset.columns);

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
}
