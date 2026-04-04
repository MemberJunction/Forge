/**
 * SQL Dialect Converter Service
 *
 * Uses sqlglot-ts (TypeScript port of Python's sqlglot) to convert
 * SQL between dialects (T-SQL ↔ PostgreSQL ↔ MySQL).
 */

import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';

const log = createLogger('SQLConverter');

export interface ConversionResult {
  success: boolean;
  sql: string;
  sourceDialect: string;
  targetDialect: string;
  error?: string;
}

// Map our engine names to sqlglot dialect names
const DIALECT_MAP: Record<string, string> = {
  mssql: 'tsql',
  postgresql: 'postgres',
  mysql: 'mysql',
};

export class SQLConverterService extends BaseSingleton {
  private transpileOne: ((sql: string, from: string, to: string) => string) | null = null;
  private loadError: string | null = null;

  constructor() {
    super();
    this.loadLibrary();
  }

  private loadLibrary(): void {
    try {
      // sqlglot-ts is ESM-only; use dynamic import wrapped in eval to bypass moduleResolution
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const importPromise = new Function('return import("sqlglot-ts")')() as Promise<{ transpileOne: (sql: string, from: string, to: string) => string }>;
      importPromise.then(mod => {
        this.transpileOne = mod.transpileOne;
        log.info('sqlglot-ts loaded successfully');
      }).catch(err => {
        this.loadError = `Failed to load sqlglot-ts: ${err}`;
        log.warn(this.loadError);
      });
    } catch (err) {
      this.loadError = `Failed to load sqlglot-ts: ${err}`;
      log.warn(this.loadError);
    }
  }

  /**
   * Convert SQL from one dialect to another
   */
  convert(sql: string, fromEngine: string, toEngine: string): ConversionResult {
    const sourceDialect = DIALECT_MAP[fromEngine] || fromEngine;
    const targetDialect = DIALECT_MAP[toEngine] || toEngine;

    if (!this.transpileOne) {
      return {
        success: false,
        sql,
        sourceDialect,
        targetDialect,
        error: this.loadError || 'SQL converter not loaded',
      };
    }

    try {
      const converted = this.transpileOne(sql, sourceDialect, targetDialect);
      log.info(`Converted SQL from ${sourceDialect} to ${targetDialect}`);
      return {
        success: true,
        sql: converted,
        sourceDialect,
        targetDialect,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`SQL conversion failed: ${errorMsg}`);
      return {
        success: false,
        sql,
        sourceDialect,
        targetDialect,
        error: `Conversion failed: ${errorMsg}`,
      };
    }
  }

  /**
   * Check if the converter is available
   */
  isAvailable(): boolean {
    return this.transpileOne !== null;
  }
}
