/**
 * Credential Store - Securely stores passwords in macOS Keychain
 */

import * as keytar from 'keytar';
import { APP_ID } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';

const SERVICE_NAME = APP_ID;

export class CredentialStore extends BaseSingleton {
  /**
   * Store a password for a connection
   */
  async set(connectionId: string, password: string): Promise<void> {
    console.log(
      `[CredentialStore] Storing password for connection: ${connectionId}, password length: ${password?.length || 0}`
    );
    try {
      await keytar.setPassword(SERVICE_NAME, connectionId, password);
      console.log(`[CredentialStore] Successfully stored password for: ${connectionId}`);
    } catch (error) {
      console.error('Failed to store credential:', error);
      throw new Error('Failed to store credential in Keychain');
    }
  }

  /**
   * Retrieve a password for a connection
   */
  async get(connectionId: string): Promise<string | null> {
    console.log(`[CredentialStore] Retrieving password for connection: ${connectionId}`);
    try {
      const password = await keytar.getPassword(SERVICE_NAME, connectionId);
      console.log(
        `[CredentialStore] Retrieved password for ${connectionId}, found: ${password ? 'yes' : 'no'}, length: ${password?.length || 0}`
      );
      return password;
    } catch (error) {
      console.error('Failed to retrieve credential:', error);
      return null;
    }
  }

  /**
   * Delete a password for a connection
   */
  async delete(connectionId: string): Promise<boolean> {
    try {
      return await keytar.deletePassword(SERVICE_NAME, connectionId);
    } catch (error) {
      console.error('Failed to delete credential:', error);
      return false;
    }
  }

  /**
   * Find all stored credentials for this app
   */
  async findAll(): Promise<Array<{ account: string; password: string }>> {
    try {
      return await keytar.findCredentials(SERVICE_NAME);
    } catch (error) {
      console.error('Failed to find credentials:', error);
      return [];
    }
  }
}
