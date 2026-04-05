/**
 * SQL Dialect Registry
 *
 * Factory for getting the correct dialect instance per database engine.
 */

import type { DatabaseEngine } from '@mj-forge/shared';
import { SQLDialect } from './sql-dialect';
import { MSSQLDialect } from './mssql-dialect';
import { PgDialect } from './pg-dialect';
import { MySQLDialect } from './mysql-dialect';

export { SQLDialect } from './sql-dialect';
export { MSSQLDialect } from './mssql-dialect';
export { PgDialect } from './pg-dialect';
export { MySQLDialect } from './mysql-dialect';

const dialects: Record<DatabaseEngine, SQLDialect> = {
  mssql: new MSSQLDialect(),
  postgresql: new PgDialect(),
  mysql: new MySQLDialect(),
};

/** Get the dialect instance for a given database engine */
export function getDialect(engine: DatabaseEngine): SQLDialect {
  return dialects[engine];
}
