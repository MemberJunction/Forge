import { Injectable, inject } from '@angular/core';
import { ConnectionStateService } from '../state/connection.state';
import { IpcService } from './ipc.service';
import type { ObjectMetadata, ColumnInfo } from '@mj-forge/shared';
import { firstValueFrom } from 'rxjs';

interface CompletionItem {
  label: string;
  kind: number; // Monaco CompletionItemKind
  detail?: string;
  documentation?: string;
  insertText: string;
  sortText?: string;
}

interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
}

@Injectable({ providedIn: 'root' })
export class SqlIntellisenseService {
  private readonly connectionState = inject(ConnectionStateService);
  private readonly ipc = inject(IpcService);

  // Cache of loaded metadata
  private tablesCache = new Map<string, TableInfo[]>();
  private viewsCache = new Map<string, string[]>();
  private proceduresCache = new Map<string, string[]>();
  private functionsCache = new Map<string, string[]>();

  // Monaco completion item kinds
  private readonly CompletionItemKind = {
    Keyword: 17,
    Snippet: 27,
    Class: 5, // Table
    Interface: 7, // View
    Function: 2, // Stored Procedure
    Method: 1, // Function
    Field: 4, // Column
    Variable: 5,
  };

  // SQL Keywords
  private readonly sqlKeywords = [
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE',
    'ORDER BY', 'GROUP BY', 'HAVING', 'DISTINCT', 'TOP', 'AS',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON',
    'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
    'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'PROCEDURE', 'FUNCTION',
    'IF', 'ELSE', 'BEGIN', 'END', 'WHILE', 'RETURN', 'DECLARE',
    'NULL', 'IS NULL', 'IS NOT NULL', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT',
    'ASC', 'DESC', 'WITH', 'NOLOCK', 'COALESCE', 'NULLIF',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CAST', 'CONVERT', 'GETDATE', 'DATEADD',
    'DATEDIFF', 'YEAR', 'MONTH', 'DAY', 'LEN', 'SUBSTRING', 'CHARINDEX', 'REPLACE',
    'ISNULL', 'ROW_NUMBER', 'OVER', 'PARTITION BY', 'RANK', 'DENSE_RANK',
    'EXEC', 'EXECUTE', 'PRINT', 'RAISERROR', 'TRY', 'CATCH', 'THROW',
    'TRANSACTION', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
    'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
    'CONSTRAINT', 'IDENTITY', 'NOT NULL', 'CLUSTERED', 'NONCLUSTERED',
  ];

  // Common snippets
  private readonly snippets = [
    {
      label: 'select_all',
      detail: 'SELECT * FROM table',
      insertText: 'SELECT *\nFROM ${1:table_name}\nWHERE ${2:condition}',
    },
    {
      label: 'select_top',
      detail: 'SELECT TOP N FROM table',
      insertText: 'SELECT TOP ${1:100} *\nFROM ${2:table_name}',
    },
    {
      label: 'insert_values',
      detail: 'INSERT INTO table VALUES',
      insertText: 'INSERT INTO ${1:table_name} (${2:columns})\nVALUES (${3:values})',
    },
    {
      label: 'update_set',
      detail: 'UPDATE table SET',
      insertText: 'UPDATE ${1:table_name}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition}',
    },
    {
      label: 'delete_where',
      detail: 'DELETE FROM table WHERE',
      insertText: 'DELETE FROM ${1:table_name}\nWHERE ${2:condition}',
    },
    {
      label: 'create_table',
      detail: 'CREATE TABLE template',
      insertText: 'CREATE TABLE ${1:table_name} (\n\t${2:column_name} ${3:datatype} ${4:constraints}\n)',
    },
    {
      label: 'create_procedure',
      detail: 'CREATE PROCEDURE template',
      insertText: 'CREATE PROCEDURE ${1:procedure_name}\n\t@${2:param} ${3:datatype}\nAS\nBEGIN\n\t${4:-- body}\nEND',
    },
    {
      label: 'try_catch',
      detail: 'TRY CATCH block',
      insertText: 'BEGIN TRY\n\t${1:-- statements}\nEND TRY\nBEGIN CATCH\n\tSELECT ERROR_MESSAGE() AS ErrorMessage\nEND CATCH',
    },
    {
      label: 'cte',
      detail: 'Common Table Expression',
      insertText: 'WITH ${1:cte_name} AS (\n\t${2:-- query}\n)\nSELECT *\nFROM ${1:cte_name}',
    },
    {
      label: 'merge',
      detail: 'MERGE statement',
      insertText: 'MERGE INTO ${1:target_table} AS target\nUSING ${2:source_table} AS source\nON ${3:condition}\nWHEN MATCHED THEN\n\tUPDATE SET ${4:updates}\nWHEN NOT MATCHED THEN\n\tINSERT (${5:columns}) VALUES (${6:values});',
    },
  ];

  /**
   * Register completion provider with Monaco
   */
  registerCompletionProvider(monacoInstance: any): void {
    if (!monacoInstance?.languages) return;

    monacoInstance.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: async (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        const suggestions: any[] = [];

        // Context-aware completions
        if (this.isAfterFrom(textBeforeCursor) || this.isAfterJoin(textBeforeCursor)) {
          // Suggest tables and views
          suggestions.push(...(await this.getTableCompletions(range)));
          suggestions.push(...(await this.getViewCompletions(range)));
        } else if (this.isAfterDot(textBeforeCursor)) {
          // Column completion after table alias or name
          const tableName = this.extractTableName(textBeforeCursor);
          if (tableName) {
            suggestions.push(...(await this.getColumnCompletions(tableName, range)));
          }
        } else if (this.isAfterExec(textBeforeCursor)) {
          // Suggest stored procedures
          suggestions.push(...(await this.getProcedureCompletions(range)));
        } else {
          // General completions
          suggestions.push(...this.getKeywordCompletions(range));
          suggestions.push(...this.getSnippetCompletions(range));
          suggestions.push(...(await this.getTableCompletions(range)));
        }

        return { suggestions };
      },
      triggerCharacters: ['.', ' '],
    });
  }

  /**
   * Load metadata for the current database
   */
  async loadMetadata(): Promise<void> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();

    if (!connectionId || !database) return;

    const cacheKey = `${connectionId}:${database}`;

    // Load tables with columns
    await this.loadTables(connectionId, database, cacheKey);
  }

  private async loadTables(connectionId: string, database: string, cacheKey: string): Promise<void> {
    try {
      const tables = await firstValueFrom(
        this.ipc.getExplorerChildren(connectionId, database, 'Tables')
      );

      const tableInfos: TableInfo[] = [];
      for (const table of tables.slice(0, 50)) { // Limit for performance
        const columns = await this.loadTableColumns(connectionId, database, table);
        tableInfos.push({
          schema: table.schema || 'dbo',
          name: table.name,
          columns,
        });
      }

      this.tablesCache.set(cacheKey, tableInfos);
    } catch (error) {
      console.error('Failed to load tables for IntelliSense:', error);
    }
  }

  private async loadTableColumns(
    connectionId: string,
    database: string,
    table: ObjectMetadata
  ): Promise<ColumnInfo[]> {
    try {
      return await firstValueFrom(
        this.ipc.getTableColumns(connectionId, database, table.schema || 'dbo', table.name)
      );
    } catch {
      return [];
    }
  }

  private getKeywordCompletions(range: any): any[] {
    return this.sqlKeywords.map((keyword, index) => ({
      label: keyword,
      kind: this.CompletionItemKind.Keyword,
      insertText: keyword,
      range,
      sortText: `0${String(index).padStart(3, '0')}`, // Keywords first
    }));
  }

  private getSnippetCompletions(range: any): any[] {
    return this.snippets.map(snippet => ({
      label: snippet.label,
      kind: this.CompletionItemKind.Snippet,
      detail: snippet.detail,
      insertText: snippet.insertText,
      insertTextRules: 4, // InsertAsSnippet
      range,
      sortText: '1', // Snippets after keywords
    }));
  }

  private async getTableCompletions(range: any): Promise<any[]> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return [];

    const cacheKey = `${connectionId}:${database}`;
    const tables = this.tablesCache.get(cacheKey) || [];

    return tables.map(table => ({
      label: `${table.schema}.${table.name}`,
      kind: this.CompletionItemKind.Class,
      detail: 'Table',
      insertText: `[${table.schema}].[${table.name}]`,
      range,
      sortText: '2',
    }));
  }

  private async getViewCompletions(range: any): Promise<any[]> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return [];

    const cacheKey = `${connectionId}:${database}`;
    const views = this.viewsCache.get(cacheKey) || [];

    return views.map(view => ({
      label: view,
      kind: this.CompletionItemKind.Interface,
      detail: 'View',
      insertText: `[${view}]`,
      range,
      sortText: '3',
    }));
  }

  private async getColumnCompletions(tableName: string, range: any): Promise<any[]> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return [];

    const cacheKey = `${connectionId}:${database}`;
    const tables = this.tablesCache.get(cacheKey) || [];

    // Find the table (handle schema.table or just table)
    const parts = tableName.split('.');
    const searchName = parts[parts.length - 1].replace(/[\[\]]/g, '');

    const table = tables.find(
      t => t.name.toLowerCase() === searchName.toLowerCase()
    );

    if (!table) return [];

    return table.columns.map(col => ({
      label: col.name,
      kind: this.CompletionItemKind.Field,
      detail: `${col.dataType}${col.isNullable ? ' (nullable)' : ''}`,
      documentation: col.isPrimaryKey ? 'Primary Key' : undefined,
      insertText: `[${col.name}]`,
      range,
      sortText: '0',
    }));
  }

  private async getProcedureCompletions(range: any): Promise<any[]> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return [];

    const cacheKey = `${connectionId}:${database}`;
    const procs = this.proceduresCache.get(cacheKey) || [];

    return procs.map(proc => ({
      label: proc,
      kind: this.CompletionItemKind.Function,
      detail: 'Stored Procedure',
      insertText: proc,
      range,
    }));
  }

  // Context detection helpers
  private isAfterFrom(text: string): boolean {
    const pattern = /\bFROM\s+$/i;
    return pattern.test(text.trim());
  }

  private isAfterJoin(text: string): boolean {
    const pattern = /\b(JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|FULL JOIN|CROSS JOIN)\s+$/i;
    return pattern.test(text.trim());
  }

  private isAfterDot(text: string): boolean {
    return text.trimEnd().endsWith('.');
  }

  private isAfterExec(text: string): boolean {
    const pattern = /\b(EXEC|EXECUTE)\s+$/i;
    return pattern.test(text.trim());
  }

  private extractTableName(text: string): string | null {
    // Match table name before the dot
    const match = text.match(/(\[?\w+\]?(?:\.\[?\w+\]?)?)\s*\.$/);
    return match ? match[1] : null;
  }

  /**
   * Clear cached metadata
   */
  clearCache(): void {
    this.tablesCache.clear();
    this.viewsCache.clear();
    this.proceduresCache.clear();
    this.functionsCache.clear();
  }
}
