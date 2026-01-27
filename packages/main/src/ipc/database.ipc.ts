/**
 * Database IPC Handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type {
  DatabaseInfo,
  CreateDatabaseOptions,
  CreateDatabaseResult,
  RenameDatabaseOptions,
  RenameDatabaseResult,
  DeleteDatabaseOptions,
  DeleteDatabaseResult,
  MJDatabaseInfo,
  MJEntityInfo,
  MJEntityFieldInfo,
  MJApplicationInfo,
} from '@mj-forge/shared';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { MetadataService } from '../services/sql/metadata';
import { TsqlBuilder } from '../utils/tsql-builder';

export function registerDatabaseHandlers(): void {
  const poolManager = ConnectionPoolManager.getInstance();
  const metadataService = MetadataService.getInstance();

  // List databases
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.LIST,
    async (_event, connectionId: string): Promise<DatabaseInfo[]> => {
      return metadataService.listDatabases(connectionId);
    }
  );

  // Create database
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.CREATE,
    async (
      _event,
      connectionId: string,
      options: CreateDatabaseOptions
    ): Promise<CreateDatabaseResult> => {
      const tsql = TsqlBuilder.createDatabase(options);

      try {
        await poolManager.batch(connectionId, tsql);
        metadataService.invalidateDatabases(connectionId);
        return { success: true, tsql };
      } catch (error) {
        const err = error as Error;
        return { success: false, tsql, error: err.message };
      }
    }
  );

  // Rename database
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.RENAME,
    async (
      _event,
      connectionId: string,
      options: RenameDatabaseOptions
    ): Promise<RenameDatabaseResult> => {
      const tsql = TsqlBuilder.renameDatabase(options);

      try {
        await poolManager.batch(connectionId, tsql);
        metadataService.invalidateDatabases(connectionId);
        return { success: true, tsql };
      } catch (error) {
        const err = error as Error;
        return { success: false, tsql, error: err.message };
      }
    }
  );

  // Delete database
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.DELETE,
    async (
      _event,
      connectionId: string,
      options: DeleteDatabaseOptions
    ): Promise<DeleteDatabaseResult> => {
      const tsql = TsqlBuilder.dropDatabase(options);

      try {
        await poolManager.batch(connectionId, tsql);
        metadataService.invalidateDatabases(connectionId);
        return { success: true, tsql };
      } catch (error) {
        const err = error as Error;
        return { success: false, tsql, error: err.message };
      }
    }
  );

  // Get database info
  ipcMain.handle(
    IPC_CHANNELS.DATABASE.GET_INFO,
    async (_event, connectionId: string, name: string): Promise<DatabaseInfo | null> => {
      const databases = await metadataService.listDatabases(connectionId);
      return databases.find(d => d.name === name) || null;
    }
  );

  // ============================================================
  // MemberJunction Integration
  // ============================================================

  // Detect if database has MemberJunction installed
  ipcMain.handle(
    IPC_CHANNELS.MJ.DETECT,
    async (
      _event,
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ): Promise<MJDatabaseInfo> => {
      return metadataService.detectMJDatabase(connectionId, database, mjSchemaName);
    }
  );

  // Get MJ entities
  ipcMain.handle(
    IPC_CHANNELS.MJ.GET_ENTITIES,
    async (
      _event,
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ): Promise<MJEntityInfo[]> => {
      return metadataService.getMJEntities(connectionId, database, mjSchemaName);
    }
  );

  // Get MJ entity fields
  ipcMain.handle(
    IPC_CHANNELS.MJ.GET_ENTITY_FIELDS,
    async (
      _event,
      connectionId: string,
      database: string,
      entityId: string,
      mjSchemaName?: string
    ): Promise<MJEntityFieldInfo[]> => {
      return metadataService.getMJEntityFields(connectionId, database, entityId, mjSchemaName);
    }
  );

  // Get MJ applications
  ipcMain.handle(
    IPC_CHANNELS.MJ.GET_APPLICATIONS,
    async (
      _event,
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ): Promise<MJApplicationInfo[]> => {
      return metadataService.getMJApplications(connectionId, database, mjSchemaName);
    }
  );
}
