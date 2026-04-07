/**
 * Connection Profiles Storage
 * Stores connection profiles (without passwords) in app data directory
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import type { ConnectionProfile, SaveConnectionRequest } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { CredentialStore } from '../keychain/credential-store';

const log = createLogger('ProfileStore');

interface ConnectionProfilesSchema {
  profiles: ConnectionProfile[];
  version: number;
}

export class ConnectionProfilesStore extends BaseSingleton {
  private store: Store<ConnectionProfilesSchema>;
  private credentialStore: CredentialStore;

  constructor() {
    super();
    this.store = new Store<ConnectionProfilesSchema>({
      name: 'connections',
      defaults: {
        profiles: [],
        version: 1,
      },
    });
    this.credentialStore = CredentialStore.getInstance();
  }

  /**
   * Get all connection profiles.
   * Backfills `engine: 'mssql'` for profiles saved before multi-DB support.
   */
  getAll(): ConnectionProfile[] {
    const profiles = this.store.get('profiles', []);
    // Backfill engine for legacy profiles
    for (const p of profiles) {
      if (!p.engine) {
        (p as ConnectionProfile).engine = 'mssql';
      }
    }
    return profiles;
  }

  /**
   * Get a single connection profile by ID
   */
  getById(id: string): ConnectionProfile | undefined {
    const profiles = this.getAll();
    return profiles.find(p => p.id === id);
  }

  /**
   * Save a connection profile (create or update)
   */
  async save(request: SaveConnectionRequest): Promise<ConnectionProfile> {
    log.info(`Saving profile: ${request.profile.name} (${request.profile.id || 'NEW'})`);

    const profiles = this.getAll();
    const now = new Date().toISOString();

    let profile: ConnectionProfile;

    if (request.profile.id) {
      // Update existing
      log.debug(`Updating existing profile: ${request.profile.id}`);
      const index = profiles.findIndex(p => p.id === request.profile.id);
      if (index === -1) {
        log.error(`Profile not found for update: ${request.profile.id}`);
        throw new Error('Connection profile not found');
      }

      profile = {
        ...profiles[index],
        ...request.profile,
        id: request.profile.id,
        updatedAt: now,
      };
      profiles[index] = profile;
      log.debug(`Updated profile at index ${index}`);
    } else {
      // Create new
      const newId = uuidv4();
      log.debug(`Creating new profile with ID: ${newId}`);
      profile = {
        ...request.profile,
        id: newId,
        createdAt: now,
        updatedAt: now,
      } as ConnectionProfile;
      profiles.push(profile);
      log.debug(`Total profiles: ${profiles.length}`);
    }

    this.store.set('profiles', profiles);
    log.debug('Profiles saved to store');

    // Store password if provided
    if (request.password) {
      log.debug(`Storing password for profile: ${profile.id}`);
      await this.credentialStore.set(profile.id, request.password);
    } else {
      log.debug('No password provided, skipping keychain storage');
    }

    log.info(`Profile saved: ${profile.id}`);
    return profile;
  }

  /**
   * Delete a connection profile
   */
  async delete(id: string): Promise<boolean> {
    const profiles = this.getAll();
    const index = profiles.findIndex(p => p.id === id);

    if (index === -1) {
      return false;
    }

    profiles.splice(index, 1);
    this.store.set('profiles', profiles);

    // Also delete the credential
    await this.credentialStore.delete(id);

    return true;
  }

  /**
   * Get password for a connection
   */
  async getPassword(id: string): Promise<string | null> {
    log.debug(`Getting password for profile: ${id}`);
    const password = await this.credentialStore.get(id);
    return password;
  }
}
