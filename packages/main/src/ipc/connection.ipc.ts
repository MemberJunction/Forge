/**
 * Connection IPC Handlers
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@mj-forge/shared';
import type { ConnectionProfile, TestConnectionResult, ActiveConnection } from '@mj-forge/shared';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { ConnectionProfilesStore } from '../services/config/connection-profiles';

export function registerConnectionHandlers(): void {
  const poolManager = ConnectionPoolManager.getInstance();
  const profileStore = ConnectionProfilesStore.getInstance();

  // Test connection
  ipcMain.handle(
    IPC_CHANNELS.CONNECTION.TEST,
    async (
      _event,
      profile: ConnectionProfile,
      password?: string
    ): Promise<TestConnectionResult> => {
      // Get password from the profile store if this is a saved profile and no password provided
      const pwd =
        password ??
        (profile.id ? ((await profileStore.getPassword(profile.id)) ?? undefined) : undefined);
      return poolManager.testConnection(profile, pwd);
    }
  );

  // Save connection
  ipcMain.handle(
    IPC_CHANNELS.CONNECTION.SAVE,
    async (_event, profile: ConnectionProfile, password?: string): Promise<ConnectionProfile> => {
      console.log(
        `[IPC:SAVE] Profile ID: ${profile.id || 'NEW'}, Name: ${profile.name}, Password provided: ${!!password}, Password length: ${password?.length || 0}`
      );
      const savedProfile = await profileStore.save({ profile, password });
      console.log(`[IPC:SAVE] Saved profile ID: ${savedProfile.id}`);
      return savedProfile;
    }
  );

  // Delete connection
  ipcMain.handle(IPC_CHANNELS.CONNECTION.DELETE, async (_event, id: string): Promise<void> => {
    try {
      await poolManager.closePool(id);
    } catch {
      // Pool may already be closed — continue with profile deletion
    }
    await profileStore.delete(id);
  });

  // List connections
  ipcMain.handle(IPC_CHANNELS.CONNECTION.LIST, async (): Promise<ConnectionProfile[]> => {
    return profileStore.getAll();
  });

  // Connect
  ipcMain.handle(
    IPC_CHANNELS.CONNECTION.CONNECT,
    async (_event, id: string): Promise<ActiveConnection> => {
      console.log(`[IPC:CONNECT] Connecting with profile ID: ${id}`);
      const profile = profileStore.getById(id);
      if (!profile) {
        console.error(`[IPC:CONNECT] Profile not found: ${id}`);
        throw new Error('Connection profile not found');
      }
      console.log(`[IPC:CONNECT] Found profile: ${profile.name}`);

      await poolManager.getPool(id);
      console.log(`[IPC:CONNECT] Successfully connected`);

      return {
        id,
        profile,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        currentDatabase: profile.database || 'master',
      };
    }
  );

  // Disconnect
  ipcMain.handle(IPC_CHANNELS.CONNECTION.DISCONNECT, async (_event, id: string): Promise<void> => {
    await poolManager.closePool(id);
  });
}
