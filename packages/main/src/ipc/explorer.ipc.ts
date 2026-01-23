/**
 * Explorer IPC Handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type {
  TableInfo,
  ViewInfo,
  ProcedureInfo,
  ObjectDefinition,
  ObjectMetadata,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
} from '@mj-forge/shared';
import { MetadataService } from '../services/sql/metadata';

export function registerExplorerHandlers(): void {
  const metadataService = MetadataService.getInstance();

  // Get children for a path (tables, views, procedures, functions)
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_CHILDREN,
    async (
      _event,
      connectionId: string,
      databaseName: string,
      parentPath: string
    ): Promise<ObjectMetadata[]> => {
      console.log(`[Explorer] Getting children for ${databaseName}/${parentPath}`);

      if (parentPath === 'tables') {
        const tables = await metadataService.listTables(connectionId, databaseName);
        return tables.map(t => ({
          name: t.name,
          type: 'table' as const,
          schema: t.schema,
          rowCount: t.rowCount,
          sizeKb: t.sizeKb,
        }));
      }

      if (parentPath === 'views') {
        const views = await metadataService.listViews(connectionId, databaseName);
        return views.map(v => ({
          name: v.name,
          type: 'view' as const,
          schema: v.schema,
        }));
      }

      if (parentPath === 'procedures') {
        const procs = await metadataService.listProcedures(connectionId, databaseName);
        return procs.map(p => ({
          name: p.name,
          type: 'procedure' as const,
          schema: p.schema,
        }));
      }

      if (parentPath === 'functions') {
        // For now, return empty - we can add function support later
        return [];
      }

      return [];
    }
  );

  // Get object details
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_OBJECT_DETAILS,
    async (
      _event,
      _connectionId: string,
      _databaseName: string,
      objectType: string,
      objectName: string,
      schema?: string
    ): Promise<ObjectMetadata> => {
      return {
        name: objectName,
        type: objectType as ObjectMetadata['type'],
        schema: schema || 'dbo',
      };
    }
  );

  // Refresh node
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.REFRESH_NODE,
    async (
      _event,
      connectionId: string,
      _databaseName: string,
      _path: string
    ): Promise<ObjectMetadata[]> => {
      // Invalidate cache and re-fetch
      metadataService.invalidateConnection(connectionId);
      // Re-use GET_CHILDREN logic
      return [];
    }
  );

  // Get tables
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_TABLES,
    async (_event, connectionId: string, database: string): Promise<TableInfo[]> => {
      return metadataService.listTables(connectionId, database);
    }
  );

  // Get views
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_VIEWS,
    async (_event, connectionId: string, database: string): Promise<ViewInfo[]> => {
      return metadataService.listViews(connectionId, database);
    }
  );

  // Get procedures
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_PROCEDURES,
    async (_event, connectionId: string, database: string): Promise<ProcedureInfo[]> => {
      return metadataService.listProcedures(connectionId, database);
    }
  );

  // Get object definition
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_DEFINITION,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      name: string,
      type: string
    ): Promise<ObjectDefinition> => {
      return metadataService.getObjectDefinition(connectionId, database, schema, name, type);
    }
  );

  // Refresh
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.REFRESH,
    async (_event, connectionId: string): Promise<void> => {
      metadataService.invalidateConnection(connectionId);
    }
  );

  // Get table columns
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_COLUMNS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<ColumnInfo[]> => {
      return metadataService.listColumns(connectionId, database, schema, table);
    }
  );

  // Get table indexes
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_INDEXES,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<IndexInfo[]> => {
      return metadataService.listIndexes(connectionId, database, schema, table);
    }
  );

  // Get table foreign keys
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_KEYS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<ForeignKeyInfo[]> => {
      return metadataService.listForeignKeys(connectionId, database, schema, table);
    }
  );

  // Get table constraints
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_CONSTRAINTS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<ConstraintInfo[]> => {
      return metadataService.listConstraints(connectionId, database, schema, table);
    }
  );

  // Get table triggers
  ipcMain.handle(
    IPC_CHANNELS.EXPLORER.GET_TABLE_TRIGGERS,
    async (
      _event,
      connectionId: string,
      database: string,
      schema: string,
      table: string
    ): Promise<TriggerInfo[]> => {
      return metadataService.listTriggers(connectionId, database, schema, table);
    }
  );
}
