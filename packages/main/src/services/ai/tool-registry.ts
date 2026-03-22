/**
 * Tool Registry - Defines and executes tools available to the AI chat agent
 */

import type { ToolDefinition } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { ConnectionPoolManager } from '../sql/connection-pool';

const log = createLogger('ToolRegistry');

// Handler function type
type ToolHandler = (
  args: Record<string, unknown>,
  connectionId?: string,
  database?: string
) => Promise<unknown>;

export class ToolRegistry extends BaseSingleton {
  private tools: Map<string, ToolDefinition> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  constructor() {
    super();
    this.registerBuiltinTools();
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get tools formatted for Google Gemini function calling API
   */
  getToolsForAPI(): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    return this.getTools().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    connectionId?: string,
    database?: string
  ): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Unknown tool: ${name}`);

    log.info(`Executing tool: ${name}`, args);
    const result = await handler(args, connectionId, database);
    return result;
  }

  private register(tool: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(tool.name, tool);
    this.handlers.set(tool.name, handler);
  }

  private registerBuiltinTools(): void {
    // ---- Query Tools ----

    this.register(
      {
        name: 'execute_query',
        description: 'Execute a SQL query against the current database and return results. Use for SELECT queries and data retrieval.',
        parameters: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'The SQL query to execute' },
          },
          required: ['sql'],
        },
        category: 'query',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const result = await pool.query<Record<string, unknown>>(connectionId, args.sql as string, database);
        const rows = result.recordset?.slice(0, 50) || [];
        return {
          rowCount: result.recordset?.length || 0,
          columns: rows.length > 0 ? Object.keys(rows[0]) : [],
          rows: rows,
          truncated: (result.recordset?.length || 0) > 50,
        };
      }
    );

    this.register(
      {
        name: 'execute_ddl',
        description: 'Execute a DDL statement (CREATE, ALTER, DROP). Use for schema modifications.',
        parameters: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: 'The DDL SQL statement to execute' },
          },
          required: ['sql'],
        },
        requiresConfirmation: true,
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        await pool.query(connectionId, args.sql as string, database);
        return { success: true, message: 'Statement executed successfully' };
      }
    );

    // ---- Schema Tools ----

    this.register(
      {
        name: 'list_tables',
        description: 'List all tables in the current database, optionally filtered by schema.',
        parameters: {
          type: 'object',
          properties: {
            schema: { type: 'string', description: 'Schema name to filter by (optional)' },
          },
        },
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schemaFilter = args.schema
          ? `AND s.name = '${(args.schema as string).replace(/'/g, "''")}'`
          : '';
        const sql = `
          SELECT s.name AS schema_name, t.name AS table_name,
                 SUM(p.rows) AS row_count
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
          WHERE t.type = 'U' ${schemaFilter}
          GROUP BY s.name, t.name
          ORDER BY s.name, t.name`;
        const result = await pool.query(connectionId, sql, database);
        return result.recordset || [];
      }
    );

    this.register(
      {
        name: 'describe_table',
        description: 'Get detailed column information for a table including data types, nullability, and primary keys.',
        parameters: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Table name' },
            schema: { type: 'string', description: 'Schema name (default: dbo)' },
          },
          required: ['table'],
        },
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schema = (args.schema as string) || 'dbo';
        const table = args.table as string;
        const sql = `
          SELECT
            c.name AS column_name,
            t.name AS data_type,
            c.max_length,
            c.is_nullable,
            c.is_identity,
            CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
          FROM sys.columns c
          JOIN sys.types t ON c.user_type_id = t.user_type_id
          JOIN sys.tables tbl ON c.object_id = tbl.object_id
          JOIN sys.schemas s ON tbl.schema_id = s.schema_id
          LEFT JOIN (
            SELECT ic.column_id, ic.object_id
            FROM sys.index_columns ic
            JOIN sys.indexes i ON ic.index_id = i.index_id AND ic.object_id = i.object_id
            WHERE i.is_primary_key = 1
          ) pk ON pk.column_id = c.column_id AND pk.object_id = c.object_id
          WHERE s.name = '${schema.replace(/'/g, "''")}' AND tbl.name = '${table.replace(/'/g, "''")}'
          ORDER BY c.column_id`;
        const result = await pool.query(connectionId, sql, database);
        return result.recordset || [];
      }
    );

    this.register(
      {
        name: 'list_databases',
        description: 'List all databases on the server.',
        parameters: { type: 'object', properties: {} },
        category: 'server',
      },
      async (_args, connectionId) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const sql = `SELECT name, state_desc, recovery_model_desc,
                     CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(10,2)) AS size_mb
                     FROM sys.databases d
                     LEFT JOIN sys.master_files f ON d.database_id = f.database_id
                     GROUP BY name, state_desc, recovery_model_desc
                     ORDER BY name`;
        const result = await pool.query(connectionId, sql);
        return result.recordset || [];
      }
    );

    this.register(
      {
        name: 'list_views',
        description: 'List all views in the current database.',
        parameters: {
          type: 'object',
          properties: {
            schema: { type: 'string', description: 'Schema name to filter by (optional)' },
          },
        },
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schemaFilter = args.schema
          ? `AND s.name = '${(args.schema as string).replace(/'/g, "''")}'`
          : '';
        const sql = `
          SELECT s.name AS schema_name, v.name AS view_name
          FROM sys.views v
          JOIN sys.schemas s ON v.schema_id = s.schema_id
          WHERE 1=1 ${schemaFilter}
          ORDER BY s.name, v.name`;
        const result = await pool.query(connectionId, sql, database);
        return result.recordset || [];
      }
    );

    this.register(
      {
        name: 'list_stored_procedures',
        description: 'List stored procedures in the current database.',
        parameters: {
          type: 'object',
          properties: {
            schema: { type: 'string', description: 'Schema name to filter by (optional)' },
          },
        },
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schemaFilter = args.schema
          ? `AND s.name = '${(args.schema as string).replace(/'/g, "''")}'`
          : '';
        const sql = `
          SELECT s.name AS schema_name, p.name AS proc_name, p.create_date, p.modify_date
          FROM sys.procedures p
          JOIN sys.schemas s ON p.schema_id = s.schema_id
          WHERE 1=1 ${schemaFilter}
          ORDER BY s.name, p.name`;
        const result = await pool.query(connectionId, sql, database);
        return result.recordset || [];
      }
    );

    // ---- Utility Tools ----

    this.register(
      {
        name: 'get_server_info',
        description: 'Get SQL Server version, edition, and configuration info.',
        parameters: { type: 'object', properties: {} },
        category: 'server',
      },
      async (_args, connectionId) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const sql = `
          SELECT
            SERVERPROPERTY('ProductVersion') AS version,
            SERVERPROPERTY('ProductLevel') AS service_pack,
            SERVERPROPERTY('Edition') AS edition,
            SERVERPROPERTY('ServerName') AS server_name,
            @@MAX_CONNECTIONS AS max_connections`;
        const result = await pool.query(connectionId, sql);
        return result.recordset?.[0] || {};
      }
    );

    this.register(
      {
        name: 'get_table_row_count',
        description: 'Get the approximate row count for a table.',
        parameters: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Table name' },
            schema: { type: 'string', description: 'Schema name (default: dbo)' },
          },
          required: ['table'],
        },
        category: 'database',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schema = (args.schema as string) || 'dbo';
        const table = args.table as string;
        const sql = `
          SELECT SUM(p.rows) AS row_count
          FROM sys.partitions p
          JOIN sys.tables t ON p.object_id = t.object_id
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          WHERE s.name = '${schema.replace(/'/g, "''")}'
            AND t.name = '${table.replace(/'/g, "''")}'
            AND p.index_id IN (0, 1)`;
        const result = await pool.query<{ row_count: number }>(connectionId, sql, database);
        return { table: `${schema}.${table}`, rowCount: result.recordset?.[0]?.row_count || 0 };
      }
    );

    this.register(
      {
        name: 'get_table_indexes',
        description: 'List indexes on a table.',
        parameters: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Table name' },
            schema: { type: 'string', description: 'Schema name (default: dbo)' },
          },
          required: ['table'],
        },
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schema = (args.schema as string) || 'dbo';
        const table = args.table as string;
        const sql = `
          SELECT i.name AS index_name, i.type_desc, i.is_unique, i.is_primary_key,
                 STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
          FROM sys.indexes i
          JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
          JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          JOIN sys.tables t ON i.object_id = t.object_id
          JOIN sys.schemas s ON t.schema_id = s.schema_id
          WHERE s.name = '${schema.replace(/'/g, "''")}' AND t.name = '${table.replace(/'/g, "''")}'
          GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
          ORDER BY i.is_primary_key DESC, i.name`;
        const result = await pool.query(connectionId, sql, database);
        return result.recordset || [];
      }
    );

    this.register(
      {
        name: 'get_foreign_keys',
        description: 'List foreign key relationships for a table.',
        parameters: {
          type: 'object',
          properties: {
            table: { type: 'string', description: 'Table name' },
            schema: { type: 'string', description: 'Schema name (default: dbo)' },
          },
          required: ['table'],
        },
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schema = (args.schema as string) || 'dbo';
        const table = args.table as string;
        const sql = `
          SELECT fk.name AS fk_name,
                 tp.name AS parent_table, cp.name AS parent_column,
                 tr.name AS referenced_table, cr.name AS referenced_column
          FROM sys.foreign_keys fk
          JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
          JOIN sys.tables tp ON fkc.parent_object_id = tp.object_id
          JOIN sys.columns cp ON fkc.parent_object_id = cp.object_id AND fkc.parent_column_id = cp.column_id
          JOIN sys.tables tr ON fkc.referenced_object_id = tr.object_id
          JOIN sys.columns cr ON fkc.referenced_object_id = cr.object_id AND fkc.referenced_column_id = cr.column_id
          JOIN sys.schemas s ON tp.schema_id = s.schema_id
          WHERE s.name = '${schema.replace(/'/g, "''")}' AND tp.name = '${table.replace(/'/g, "''")}'
          ORDER BY fk.name`;
        const result = await pool.query(connectionId, sql, database);
        return result.recordset || [];
      }
    );

    this.register(
      {
        name: 'get_object_definition',
        description: 'Get the CREATE script / definition for a view, stored procedure, or function.',
        parameters: {
          type: 'object',
          properties: {
            object_name: { type: 'string', description: 'Object name' },
            schema: { type: 'string', description: 'Schema name (default: dbo)' },
          },
          required: ['object_name'],
        },
        category: 'schema',
      },
      async (args, connectionId, database) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const schema = (args.schema as string) || 'dbo';
        const objectName = args.object_name as string;
        const sql = `SELECT OBJECT_DEFINITION(OBJECT_ID('${schema.replace(/'/g, "''")}.${objectName.replace(/'/g, "''")}')) AS definition`;
        const result = await pool.query<{ definition: string }>(connectionId, sql, database);
        const definition = result.recordset?.[0]?.definition;
        return { objectName: `${schema}.${objectName}`, definition: definition || 'Definition not available (may be a table or encrypted object)' };
      }
    );

    this.register(
      {
        name: 'create_database',
        description: 'Create a new database on the server.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Database name' },
          },
          required: ['name'],
        },
        requiresConfirmation: true,
        category: 'server',
      },
      async (args, connectionId) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const dbName = (args.name as string).replace(/[[\]]/g, '');
        await pool.query(connectionId, `CREATE DATABASE [${dbName}]`);
        return { success: true, message: `Database [${dbName}] created successfully` };
      }
    );

    this.register(
      {
        name: 'rename_database',
        description: 'Rename a database.',
        parameters: {
          type: 'object',
          properties: {
            current_name: { type: 'string', description: 'Current database name' },
            new_name: { type: 'string', description: 'New database name' },
          },
          required: ['current_name', 'new_name'],
        },
        requiresConfirmation: true,
        category: 'server',
      },
      async (args, connectionId) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const currentName = (args.current_name as string).replace(/[[\]]/g, '');
        const newName = (args.new_name as string).replace(/[[\]]/g, '');
        await pool.query(connectionId, `ALTER DATABASE [${currentName}] MODIFY NAME = [${newName}]`);
        return { success: true, message: `Database renamed from [${currentName}] to [${newName}]` };
      }
    );

    this.register(
      {
        name: 'delete_database',
        description: 'Drop/delete a database. This is destructive and cannot be undone.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Database name to delete' },
          },
          required: ['name'],
        },
        requiresConfirmation: true,
        category: 'server',
      },
      async (args, connectionId) => {
        if (!connectionId) throw new Error('No active connection');
        const pool = ConnectionPoolManager.getInstance();
        const dbName = (args.name as string).replace(/[[\]]/g, '');
        await pool.query(connectionId, `ALTER DATABASE [${dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${dbName}]`);
        return { success: true, message: `Database [${dbName}] deleted` };
      }
    );
  }
}
