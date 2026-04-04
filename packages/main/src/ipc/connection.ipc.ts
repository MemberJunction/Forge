/**
 * Connection IPC Handlers
 */

import { IPC_CHANNELS } from '@mj-forge/shared';
import type { ConnectionProfile, TestConnectionResult, ActiveConnection } from '@mj-forge/shared';
import { ConnectionPoolManager } from '../services/sql/connection-pool';
import { ConnectionProfilesStore } from '../services/config/connection-profiles';
import { createLogger } from '../utils/logger';
import { safeHandle } from './safe-handle';

const log = createLogger('IPC:Connection');

export function registerConnectionHandlers(): void {
  const poolManager = ConnectionPoolManager.getInstance();
  const profileStore = ConnectionProfilesStore.getInstance();

  // Test connection
  safeHandle(
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
  safeHandle(
    IPC_CHANNELS.CONNECTION.SAVE,
    async (_event, profile: ConnectionProfile, password?: string): Promise<ConnectionProfile> => {
      log.info(`Saving profile: ${profile.name}`);
      const savedProfile = await profileStore.save({ profile, password });
      return savedProfile;
    }
  );

  // Delete connection
  safeHandle(IPC_CHANNELS.CONNECTION.DELETE, async (_event, id: string): Promise<void> => {
    try {
      await poolManager.closePool(id);
    } catch {
      // Pool may already be closed — continue with profile deletion
    }
    await profileStore.delete(id);
  });

  // List connections
  safeHandle(IPC_CHANNELS.CONNECTION.LIST, async (): Promise<ConnectionProfile[]> => {
    return profileStore.getAll();
  });

  // Connect
  safeHandle(
    IPC_CHANNELS.CONNECTION.CONNECT,
    async (_event, id: string): Promise<ActiveConnection> => {
      log.info(`Connecting with profile: ${id}`);
      const profile = profileStore.getById(id);
      if (!profile) {
        log.error(`Profile not found: ${id}`);
        throw new Error('Connection profile not found');
      }

      const engine = profile.engine || 'mssql';
      if (engine === 'postgresql') {
        await poolManager.getPgPool(id);
      } else {
        await poolManager.getPool(id);
      }
      log.info(`Connected to ${profile.name} (${engine})`);

      const defaultDb =
        engine === 'postgresql' ? profile.database || 'postgres' : profile.database || 'master';

      return {
        id,
        profile,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        currentDatabase: defaultDb,
      };
    }
  );

  // Disconnect
  safeHandle(IPC_CHANNELS.CONNECTION.DISCONNECT, async (_event, id: string): Promise<void> => {
    await poolManager.closePool(id);
  });
}
