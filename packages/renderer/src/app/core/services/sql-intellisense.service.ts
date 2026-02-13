import { Injectable, inject } from '@angular/core';
import { ConnectionStateService } from '../state/connection.state';
import { IpcService } from './ipc.service';
import type { ObjectMetadata, ColumnInfo } from '@mj-forge/shared';
import { firstValueFrom } from 'rxjs';

interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
}

interface ViewInfo {
  schema: string;
  name: string;
}

interface MonacoRange {
  startLineNumber: number;
  endLineNumber: number;
  startColumn: number;
  endColumn: number;
}

interface MonacoPosition {
  lineNumber: number;
  column: number;
}

interface MonacoWord {
  startColumn: number;
  endColumn: number;
}

interface MonacoModel {
  getWordUntilPosition(position: MonacoPosition): MonacoWord;
  getValueInRange(range: MonacoRange): string;
  getLineContent(lineNumber: number): string;
  getValue(): string;
}

interface MonacoCompletionItem {
  label: string;
  kind: number;
  detail?: string;
  insertText: string;
  insertTextRules?: number;
  range: MonacoRange;
  sortText?: string;
}

interface MonacoLanguages {
  registerCompletionItemProvider(
    languageId: string,
    provider: {
      provideCompletionItems: (
        model: MonacoModel,
        position: MonacoPosition
      ) => Promise<{ suggestions: MonacoCompletionItem[] }>;
      triggerCharacters: string[];
    }
  ): void;
}

interface MonacoInstance {
  languages: MonacoLanguages;
}

@Injectable({ providedIn: 'root' })
export class SqlIntellisenseService {
  private readonly connectionState = inject(ConnectionStateService);
  private readonly ipc = inject(IpcService);

  private providerRegistered = false;

  // Cache of loaded metadata
  private tablesCache = new Map<string, TableInfo[]>();
  private viewsCache = new Map<string, ViewInfo[]>();
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
    'SELECT',
    'FROM',
    'WHERE',
    'AND',
    'OR',
    'NOT',
    'IN',
    'BETWEEN',
    'LIKE',
    'ORDER BY',
    'GROUP BY',
    'HAVING',
    'DISTINCT',
    'TOP',
    'AS',
    'JOIN',
    'INNER JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'FULL JOIN',
    'CROSS JOIN',
    'ON',
    'INSERT',
    'INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE',
    'CREATE',
    'ALTER',
    'DROP',
    'TABLE',
    'VIEW',
    'INDEX',
    'PROCEDURE',
    'FUNCTION',
    'IF',
    'ELSE',
    'BEGIN',
    'END',
    'WHILE',
    'RETURN',
    'DECLARE',
    'NULL',
    'IS NULL',
    'IS NOT NULL',
    'EXISTS',
    'CASE',
    'WHEN',
    'THEN',
    'ELSE',
    'END',
    'UNION',
    'UNION ALL',
    'EXCEPT',
    'INTERSECT',
    'ASC',
    'DESC',
    'WITH',
    'NOLOCK',
    'COALESCE',
    'NULLIF',
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'CAST',
    'CONVERT',
    'GETDATE',
    'DATEADD',
    'DATEDIFF',
    'YEAR',
    'MONTH',
    'DAY',
    'LEN',
    'SUBSTRING',
    'CHARINDEX',
    'REPLACE',
    'ISNULL',
    'ROW_NUMBER',
    'OVER',
    'PARTITION BY',
    'RANK',
    'DENSE_RANK',
    'EXEC',
    'EXECUTE',
    'PRINT',
    'RAISERROR',
    'TRY',
    'CATCH',
    'THROW',
    'TRANSACTION',
    'COMMIT',
    'ROLLBACK',
    'SAVEPOINT',
    'PRIMARY KEY',
    'FOREIGN KEY',
    'REFERENCES',
    'UNIQUE',
    'CHECK',
    'DEFAULT',
    'CONSTRAINT',
    'IDENTITY',
    'NOT NULL',
    'CLUSTERED',
    'NONCLUSTERED',
    'USE',
    'GO',
    'TRUNCATE',
    'MERGE',
    'OUTPUT',
    'INSERTED',
    'DELETED',
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
      insertText:
        'CREATE TABLE ${1:table_name} (\n\t${2:column_name} ${3:datatype} ${4:constraints}\n)',
    },
    {
      label: 'create_procedure',
      detail: 'CREATE PROCEDURE template',
      insertText:
        'CREATE PROCEDURE ${1:procedure_name}\n\t@${2:param} ${3:datatype}\nAS\nBEGIN\n\t${4:-- body}\nEND',
    },
    {
      label: 'try_catch',
      detail: 'TRY CATCH block',
      insertText:
        'BEGIN TRY\n\t${1:-- statements}\nEND TRY\nBEGIN CATCH\n\tSELECT ERROR_MESSAGE() AS ErrorMessage\nEND CATCH',
    },
    {
      label: 'cte',
      detail: 'Common Table Expression',
      insertText: 'WITH ${1:cte_name} AS (\n\t${2:-- query}\n)\nSELECT *\nFROM ${1:cte_name}',
    },
    {
      label: 'merge',
      detail: 'MERGE statement',
      insertText:
        'MERGE INTO ${1:target_table} AS target\nUSING ${2:source_table} AS source\nON ${3:condition}\nWHEN MATCHED THEN\n\tUPDATE SET ${4:updates}\nWHEN NOT MATCHED THEN\n\tINSERT (${5:columns}) VALUES (${6:values});',
    },
  ];

  /**
   * Register completion provider with Monaco (idempotent)
   */
  registerCompletionProvider(monacoInstance: MonacoInstance): void {
    if (this.providerRegistered || !monacoInstance?.languages) return;
    this.providerRegistered = true;

    monacoInstance.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: async (model: MonacoModel, position: MonacoPosition) => {
        const word = model.getWordUntilPosition(position);
        const range: MonacoRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Get full text from start of document to cursor for multi-line context
        const fullTextBeforeCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        const lineContent = model.getLineContent(position.lineNumber);
        const lineBeforeCursor = lineContent.substring(0, position.column - 1);

        const suggestions: MonacoCompletionItem[] = [];

        // Context-aware completions
        if (this.isAfterUse(fullTextBeforeCursor)) {
          suggestions.push(...this.getDatabaseCompletions(range));
        } else if (
          this.isAfterFrom(fullTextBeforeCursor) ||
          this.isAfterJoin(fullTextBeforeCursor)
        ) {
          suggestions.push(...(await this.getTableCompletions(range)));
          suggestions.push(...(await this.getViewCompletions(range)));
        } else if (this.isAfterDot(lineBeforeCursor)) {
          const nameBeforeDot = this.extractTableName(lineBeforeCursor);
          if (nameBeforeDot) {
            // Try alias resolution first, then direct table name match
            const fullText = model.getValue();
            const resolvedTable = this.resolveAlias(nameBeforeDot, fullText) || nameBeforeDot;
            suggestions.push(...(await this.getColumnCompletions(resolvedTable, range)));
          }
        } else if (this.isAfterExec(fullTextBeforeCursor)) {
          suggestions.push(...(await this.getProcedureCompletions(range)));
        } else {
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
   * Load metadata for the current database (tables, views, procedures)
   */
  async loadMetadata(): Promise<void> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();

    if (!connectionId || !database) return;

    const cacheKey = `${connectionId}:${database}`;

    // Skip if already cached for this connection+database
    if (this.tablesCache.has(cacheKey)) return;

    await Promise.all([
      this.loadTables(connectionId, database, cacheKey),
      this.loadViews(connectionId, database, cacheKey),
      this.loadProcedures(connectionId, database, cacheKey),
    ]);
  }

  /**
   * Force reload metadata (e.g. after database switch)
   */
  async reloadMetadata(): Promise<void> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();

    if (!connectionId || !database) return;

    const cacheKey = `${connectionId}:${database}`;

    // Clear existing cache for this key and reload
    this.tablesCache.delete(cacheKey);
    this.viewsCache.delete(cacheKey);
    this.proceduresCache.delete(cacheKey);
    this.functionsCache.delete(cacheKey);

    await Promise.all([
      this.loadTables(connectionId, database, cacheKey),
      this.loadViews(connectionId, database, cacheKey),
      this.loadProcedures(connectionId, database, cacheKey),
    ]);
  }

  private async loadTables(
    connectionId: string,
    database: string,
    cacheKey: string
  ): Promise<void> {
    try {
      const tables = await firstValueFrom(
        this.ipc.getExplorerChildren(connectionId, database, 'tables')
      );

      // Load columns in parallel batches
      const batchSize = 10;
      const tableInfos: TableInfo[] = [];

      for (let i = 0; i < tables.length; i += batchSize) {
        const batch = tables.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async table => ({
            schema: table.schema || 'dbo',
            name: table.name,
            columns: await this.loadTableColumns(connectionId, database, table),
          }))
        );
        tableInfos.push(...batchResults);
      }

      this.tablesCache.set(cacheKey, tableInfos);
    } catch {
      // Non-critical: IntelliSense will work without table data
    }
  }

  private async loadViews(connectionId: string, database: string, cacheKey: string): Promise<void> {
    try {
      const views = await firstValueFrom(
        this.ipc.getExplorerChildren(connectionId, database, 'views')
      );
      this.viewsCache.set(
        cacheKey,
        views.map(v => ({ schema: v.schema || 'dbo', name: v.name }))
      );
    } catch {
      // Non-critical: IntelliSense will work without view data
    }
  }

  private async loadProcedures(
    connectionId: string,
    database: string,
    cacheKey: string
  ): Promise<void> {
    try {
      const procs = await firstValueFrom(
        this.ipc.getExplorerChildren(connectionId, database, 'procedures')
      );
      this.proceduresCache.set(
        cacheKey,
        procs.map(p => (p.schema && p.schema !== 'dbo' ? `[${p.schema}].[${p.name}]` : p.name))
      );
    } catch {
      // Non-critical: IntelliSense will work without procedure data
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

  // --- Completion generators ---

  private getKeywordCompletions(range: MonacoRange): MonacoCompletionItem[] {
    return this.sqlKeywords.map((keyword, index) => ({
      label: keyword,
      kind: this.CompletionItemKind.Keyword,
      insertText: keyword,
      range,
      sortText: `0${String(index).padStart(3, '0')}`,
    }));
  }

  private getSnippetCompletions(range: MonacoRange): MonacoCompletionItem[] {
    return this.snippets.map(snippet => ({
      label: snippet.label,
      kind: this.CompletionItemKind.Snippet,
      detail: snippet.detail,
      insertText: snippet.insertText,
      insertTextRules: 4, // InsertAsSnippet
      range,
      sortText: '1',
    }));
  }

  private getDatabaseCompletions(range: MonacoRange): MonacoCompletionItem[] {
    const databases = this.connectionState.databases();
    return databases.map(db => ({
      label: db.name,
      kind: this.CompletionItemKind.Class,
      detail: 'Database',
      insertText: `[${db.name}]`,
      range,
      sortText: '0',
    }));
  }

  private async getTableCompletions(range: MonacoRange): Promise<MonacoCompletionItem[]> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return [];

    const cacheKey = `${connectionId}:${database}`;
    const tables = this.tablesCache.get(cacheKey) || [];

    return tables.map(table => ({
      label: table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`,
      kind: this.CompletionItemKind.Class,
      detail: `Table (${table.schema})`,
      insertText: table.schema === 'dbo' ? `[${table.name}]` : `[${table.schema}].[${table.name}]`,
      range,
      sortText: '2',
    }));
  }

  private async getViewCompletions(range: MonacoRange): Promise<MonacoCompletionItem[]> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return [];

    const cacheKey = `${connectionId}:${database}`;
    const views = this.viewsCache.get(cacheKey) || [];

    return views.map(view => ({
      label: view.schema === 'dbo' ? view.name : `${view.schema}.${view.name}`,
      kind: this.CompletionItemKind.Interface,
      detail: `View (${view.schema})`,
      insertText: view.schema === 'dbo' ? `[${view.name}]` : `[${view.schema}].[${view.name}]`,
      range,
      sortText: '3',
    }));
  }

  private async getColumnCompletions(
    tableName: string,
    range: MonacoRange
  ): Promise<MonacoCompletionItem[]> {
    const connectionId = this.connectionState.activeConnectionId();
    const database = this.connectionState.selectedDatabase();
    if (!connectionId || !database) return [];

    const cacheKey = `${connectionId}:${database}`;
    const tables = this.tablesCache.get(cacheKey) || [];

    // Clean brackets and handle schema.table or just table
    const parts = tableName.split('.');
    const searchName = parts[parts.length - 1].replace(/[[\]]/g, '');
    const searchSchema = parts.length > 1 ? parts[0].replace(/[[\]]/g, '') : null;

    const table = tables.find(t => {
      const nameMatch = t.name.toLowerCase() === searchName.toLowerCase();
      if (searchSchema) {
        return nameMatch && t.schema.toLowerCase() === searchSchema.toLowerCase();
      }
      return nameMatch;
    });

    if (!table) return [];

    return table.columns.map(col => ({
      label: col.name,
      kind: this.CompletionItemKind.Field,
      detail: `${col.dataType}${col.isNullable ? ' (nullable)' : ''}${col.isPrimaryKey ? ' PK' : ''}`,
      insertText: col.name,
      range,
      sortText: col.isPrimaryKey ? '0' : '1',
    }));
  }

  private async getProcedureCompletions(range: MonacoRange): Promise<MonacoCompletionItem[]> {
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

  // --- Context detection helpers ---

  private isAfterUse(text: string): boolean {
    return /\bUSE\s+$/i.test(text.trimEnd());
  }

  private isAfterFrom(text: string): boolean {
    // Match FROM (with optional comma for multi-table selects) at end of text
    return /\b(FROM|,)\s+$/i.test(text.trimEnd());
  }

  private isAfterJoin(text: string): boolean {
    return /\b(JOIN|INNER\s+JOIN|LEFT\s+(OUTER\s+)?JOIN|RIGHT\s+(OUTER\s+)?JOIN|FULL\s+(OUTER\s+)?JOIN|CROSS\s+JOIN)\s+$/i.test(
      text.trimEnd()
    );
  }

  private isAfterDot(text: string): boolean {
    return text.trimEnd().endsWith('.');
  }

  private isAfterExec(text: string): boolean {
    return /\b(EXEC|EXECUTE)\s+$/i.test(text.trimEnd());
  }

  private extractTableName(text: string): string | null {
    const match = text.match(/(\[?\w+]?(?:\.\[?\w+]?)?)\s*\.$/);
    return match ? match[1] : null;
  }

  /**
   * Parse table aliases from the full query text.
   * Handles: FROM table alias, FROM table AS alias, JOIN table alias ON, JOIN table AS alias ON
   */
  private parseTableAliases(fullText: string): Map<string, string> {
    const aliases = new Map<string, string>();

    // Match: FROM/JOIN [schema.]table [AS] alias
    const pattern = /\b(?:FROM|JOIN)\s+(\[?\w+]?(?:\.\[?\w+]?)?)\s+(?:AS\s+)?(\w+)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(fullText)) !== null) {
      const tableName = match[1];
      const alias = match[2].toLowerCase();
      // Skip SQL keywords that look like aliases
      const reserved = new Set([
        'where',
        'on',
        'inner',
        'left',
        'right',
        'full',
        'cross',
        'outer',
        'join',
        'set',
        'values',
        'into',
        'group',
        'order',
        'having',
        'union',
        'except',
        'intersect',
        'as',
        'with',
        'nolock',
      ]);
      if (!reserved.has(alias)) {
        aliases.set(alias, tableName);
      }
    }

    return aliases;
  }

  /**
   * Resolve an alias to a table name, or return null if not an alias
   */
  private resolveAlias(nameBeforeDot: string, fullText: string): string | null {
    const cleaned = nameBeforeDot.replace(/[[\]]/g, '').toLowerCase();
    const aliases = this.parseTableAliases(fullText);
    return aliases.get(cleaned) || null;
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
