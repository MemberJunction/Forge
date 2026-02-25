/**
 * Credential Store - Securely stores passwords in macOS Keychain
 * Uses a single JSON blob to minimize keychain access (only once at startup)
 */

import * as keytar from 'keytar';
import { APP_ID } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';

const SERVICE_NAME = APP_ID;
const CREDENTIALS_KEY = 'credentials-vault';

interface CredentialsVault {
  [key: string]: string;
}

export class CredentialStore extends BaseSingleton {
  // In-memory cache - all credentials loaded from single keychain entry
  private cache: Map<string, string> = new Map();
  private cacheLoaded = false;
  private keychainAvailable = true;

  /**
   * Load all credentials from keychain into memory cache (called once at startup)
   */
  async loadAllIntoCache(): Promise<void> {
    if (this.cacheLoaded) return;

    console.log('[CredentialStore] Loading credentials vault from keychain...');
    try {
      // First, try to load the new single-entry vault
      const vaultJson = await keytar.getPassword(SERVICE_NAME, CREDENTIALS_KEY);

      if (vaultJson) {
        // Parse the JSON vault
        const vault: CredentialsVault = JSON.parse(vaultJson);
        for (const [key, value] of Object.entries(vault)) {
          this.cache.set(key, value);
        }
        console.log(`[CredentialStore] Loaded ${this.cache.size} credentials from vault`);
      } else {
        // Migration: Check for old individual entries and migrate them
        console.log('[CredentialStore] No vault found, checking for legacy credentials...');
        const legacyCredentials = await keytar.findCredentials(SERVICE_NAME);
        const nonVaultCredentials = legacyCredentials.filter(c => c.account !== CREDENTIALS_KEY);

        if (nonVaultCredentials.length > 0) {
          console.log(
            `[CredentialStore] Migrating ${nonVaultCredentials.length} legacy credentials...`
          );
          for (const cred of nonVaultCredentials) {
            this.cache.set(cred.account, cred.password);
          }
          // Save to new vault format
          await this.saveVault();
          // Clean up old individual entries
          for (const cred of nonVaultCredentials) {
            await keytar.deletePassword(SERVICE_NAME, cred.account);
          }
          console.log('[CredentialStore] Migration complete');
        }
      }

      this.cacheLoaded = true;
    } catch (error) {
      // Keychain access denied or unavailable - app will continue without saved credentials
      this.keychainAvailable = false;
      this.cacheLoaded = true;
      console.warn(
        '[CredentialStore] Keychain access unavailable - saved credentials will not be loaded.',
        'The app will continue without stored passwords. Grant keychain access to enable credential storage.'
      );
      console.debug('[CredentialStore] Keychain error details:', error);
    }
  }

  /**
   * Save the entire vault to keychain (debounced to batch rapid updates)
   */
  private async saveVault(): Promise<void> {
    const vault: CredentialsVault = Object.fromEntries(this.cache);
    const vaultJson = JSON.stringify(vault);
    await keytar.setPassword(SERVICE_NAME, CREDENTIALS_KEY, vaultJson);
    console.log(`[CredentialStore] Saved vault with ${this.cache.size} credentials`);
  }

  /**
   * Store a password for a connection
   */
  async set(connectionId: string, password: string): Promise<void> {
    console.log(
      `[CredentialStore] Storing password for: ${connectionId}, length: ${password?.length || 0}`
    );
    try {
      // Ensure cache is loaded first
      if (!this.cacheLoaded) {
        await this.loadAllIntoCache();
      }

      // Update cache (always store in memory even if keychain is unavailable)
      this.cache.set(connectionId, password);

      // Only attempt to persist if keychain is available
      if (this.keychainAvailable) {
        await this.saveVault();
        console.log(`[CredentialStore] Successfully stored password for: ${connectionId}`);
      } else {
        console.warn(
          `[CredentialStore] Password cached in memory for: ${connectionId} (keychain unavailable - will not persist)`
        );
      }
    } catch (error) {
      // Keychain became unavailable - mark it and keep in memory cache
      this.keychainAvailable = false;
      console.warn(
        `[CredentialStore] Failed to persist credential for ${connectionId} - keychain access denied.`,
        'Password is cached in memory for this session only.'
      );
      console.debug('[CredentialStore] Keychain error details:', error);
    }
  }

  /**
   * Retrieve a password for a connection (uses cache after initial load)
   */
  async get(connectionId: string): Promise<string | null> {
    // Ensure cache is loaded
    if (!this.cacheLoaded) {
      await this.loadAllIntoCache();
    }

    // Return from cache
    const cached = this.cache.get(connectionId);
    if (cached !== undefined) {
      console.log(`[CredentialStore] Retrieved password from cache for: ${connectionId}`);
      return cached;
    }

    console.log(`[CredentialStore] Password not in cache for: ${connectionId}`);
    return null;
  }

  /**
   * Delete a password for a connection
   */
  async delete(connectionId: string): Promise<boolean> {
    try {
      // Ensure cache is loaded first
      if (!this.cacheLoaded) {
        await this.loadAllIntoCache();
      }

      // Remove from cache
      const existed = this.cache.has(connectionId);
      this.cache.delete(connectionId);

      // Save updated vault to keychain (only if available)
      if (existed && this.keychainAvailable) {
        await this.saveVault();
      }

      return existed;
    } catch (error) {
      // Keychain became unavailable - still removed from memory cache
      this.keychainAvailable = false;
      console.warn('[CredentialStore] Failed to persist deletion - keychain unavailable');
      return true; // Still removed from memory
    }
  }

  /**
   * Check if keychain access is available
   */
  isKeychainAvailable(): boolean {
    return this.keychainAvailable;
  }

  /**
   * Find all stored credentials for this app (uses cache after initial load)
   */
  async findAll(): Promise<Array<{ account: string; password: string }>> {
    // Ensure cache is loaded
    if (!this.cacheLoaded) {
      await this.loadAllIntoCache();
    }

    // Return from cache
    return Array.from(this.cache.entries()).map(([account, password]) => ({
      account,
      password,
    }));
  }
}
