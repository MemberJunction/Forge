/**
 * Connection Profiles Storage
 * Stores connection profiles (without passwords) in app data directory
 */

import Store from 'electron-store';
import { v4 as uuidv4 } from 'uuid';
import type { ConnectionProfile, SaveConnectionRequest } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { CredentialStore } from '../keychain/credential-store';

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
   * Get all connection profiles
   */
  getAll(): ConnectionProfile[] {
    return this.store.get('profiles', []);
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
    console.log(
      `[ProfileStore:SAVE] Starting save. Profile ID: ${request.profile.id || 'NEW'}, Name: ${request.profile.name}`
    );
    console.log(
      `[ProfileStore:SAVE] Password provided: ${!!request.password}, Password length: ${request.password?.length || 0}`
    );

    const profiles = this.getAll();
    const now = new Date().toISOString();

    let profile: ConnectionProfile;

    if (request.profile.id) {
      // Update existing
      console.log(`[ProfileStore:SAVE] Updating existing profile: ${request.profile.id}`);
      const index = profiles.findIndex(p => p.id === request.profile.id);
      if (index === -1) {
        console.error(`[ProfileStore:SAVE] Profile not found for update: ${request.profile.id}`);
        throw new Error('Connection profile not found');
      }

      profile = {
        ...profiles[index],
        ...request.profile,
        id: request.profile.id,
        updatedAt: now,
      };
      profiles[index] = profile;
      console.log(`[ProfileStore:SAVE] Updated profile at index ${index}`);
    } else {
      // Create new
      const newId = uuidv4();
      console.log(`[ProfileStore:SAVE] Creating new profile with generated ID: ${newId}`);
      profile = {
        ...request.profile,
        id: newId,
        createdAt: now,
        updatedAt: now,
      } as ConnectionProfile;
      profiles.push(profile);
      console.log(
        `[ProfileStore:SAVE] Added new profile to list. Total profiles: ${profiles.length}`
      );
    }

    this.store.set('profiles', profiles);
    console.log(`[ProfileStore:SAVE] Profiles saved to store`);

    // Store password if provided
    if (request.password) {
      console.log(`[ProfileStore:SAVE] About to store password for profile ID: ${profile.id}`);
      await this.credentialStore.set(profile.id, request.password);
      console.log(`[ProfileStore:SAVE] Password stored in keychain for: ${profile.id}`);
    } else {
      console.log(`[ProfileStore:SAVE] No password provided, skipping keychain storage`);
    }

    console.log(`[ProfileStore:SAVE] Save complete. Returning profile ID: ${profile.id}`);
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
    console.log(`[ProfileStore:GET_PASSWORD] Getting password for profile ID: ${id}`);
    const password = await this.credentialStore.get(id);
    console.log(
      `[ProfileStore:GET_PASSWORD] Password retrieved for ${id}: found=${!!password}, length=${password?.length || 0}`
    );
    return password;
  }
}
