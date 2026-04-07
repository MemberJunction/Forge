/**
 * SQL Dialect Converter Service
 *
 * Uses @memberjunction/sqlglot-ts which spawns a Python FastAPI microservice
 * wrapping the real Python sqlglot library. Much more reliable than pure TS ports.
 *
 * Lifecycle:
 * - The Python microservice is started lazily on first conversion request
 * - It runs on 127.0.0.1 with an ephemeral port
 * - It is stopped during app shutdown
 */

import { SqlGlotClient } from '@memberjunction/sqlglot-ts';
import type { TranspileResult, SQLDialect as SqlGlotDialect } from '@memberjunction/sqlglot-ts';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';

const log = createLogger('SQLConverter');

export interface ConversionResult {
  success: boolean;
  sql: string;
  sourceDialect: string;
  targetDialect: string;
  statements?: string[];
  warnings?: string[];
  error?: string;
}

// Map our engine names to sqlglot dialect names
const DIALECT_MAP: Record<string, SqlGlotDialect> = {
  mssql: 'tsql',
  postgresql: 'postgres',
  mysql: 'mysql',
};

export class SQLConverterService extends BaseSingleton {
  private client: SqlGlotClient;
  private starting: Promise<void> | null = null;

  constructor() {
    super();
    this.client = new SqlGlotClient({
      startupTimeoutMs: 15000,
      requestTimeoutMs: 30000,
    });
  }

  /**
   * Ensure the Python microservice is running
   */
  private async ensureRunning(): Promise<void> {
    if (this.client.IsRunning) return;

    // Serialize concurrent start requests
    if (!this.starting) {
      this.starting = this.client.start()
        .then(() => {
          log.info(`sqlglot microservice started on port ${this.client.Port}`);
          this.starting = null;
        })
        .catch(err => {
          this.starting = null;
          throw err;
        });
    }

    return this.starting;
  }

  /**
   * Convert SQL from one dialect to another
   */
  async convert(sql: string, fromEngine: string, toEngine: string): Promise<ConversionResult> {
    const fromDialect = DIALECT_MAP[fromEngine] || fromEngine;
    const toDialect = DIALECT_MAP[toEngine] || toEngine;

    try {
      await this.ensureRunning();

      const result: TranspileResult = await this.client.transpile(sql, {
        fromDialect,
        toDialect,
        pretty: true,
        errorLevel: 'WARN',
      });

      log.info(`Converted SQL from ${fromDialect} to ${toDialect} (${result.statements.length} statements)`);

      return {
        success: result.success,
        sql: result.sql,
        sourceDialect: fromDialect,
        targetDialect: toDialect,
        statements: result.statements,
        warnings: result.warnings,
        error: result.errors.length > 0 ? result.errors.join('\n') : undefined,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`SQL conversion failed: ${errorMsg}`);

      // Check for common issues
      let userError = errorMsg;
      if (errorMsg.includes('ENOENT') || errorMsg.includes('python')) {
        userError = 'Python 3 is required for SQL conversion. Please install Python 3 and ensure "python3" is on your PATH.';
      } else if (errorMsg.includes('timeout')) {
        userError = 'SQL conversion service timed out. The microservice may still be starting — try again.';
      }

      return {
        success: false,
        sql,
        sourceDialect: fromDialect,
        targetDialect: toDialect,
        error: userError,
      };
    }
  }

  /**
   * Check if the converter service is running
   */
  isRunning(): boolean {
    return this.client.IsRunning;
  }

  /**
   * Stop the Python microservice (called during app shutdown)
   */
  async stop(): Promise<void> {
    if (this.client.IsRunning) {
      log.info('Stopping sqlglot microservice...');
      await this.client.stop();
      log.info('sqlglot microservice stopped');
    }
  }
}
