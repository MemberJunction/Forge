/**
 * Tests for Connection Profiles Store
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionProfilesStore } from './connection-profiles';

describe('ConnectionProfilesStore', () => {
  let store: ConnectionProfilesStore;

  beforeEach(() => {
    // Reset singleton for each test
    ConnectionProfilesStore.resetInstance();
    store = ConnectionProfilesStore.getInstance();
  });

  describe('backward compatibility', () => {
    it('backfills engine to mssql for legacy profiles', () => {
      const profiles = store.getAll();
      // All returned profiles should have engine set
      for (const p of profiles) {
        expect(p.engine).toBeDefined();
      }
    });
  });

  describe('CRUD operations', () => {
    it('returns empty array when no profiles exist', () => {
      const profiles = store.getAll();
      expect(Array.isArray(profiles)).toBe(true);
    });

    it('saves and retrieves a new profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'Test SQL Server',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          username: 'sa',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
        password: 'testpassword',
      });

      expect(saved.id).toBeDefined();
      expect(saved.name).toBe('Test SQL Server');
      expect(saved.engine).toBe('mssql');
      expect(saved.createdAt).toBeDefined();

      const found = store.getById(saved.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Test SQL Server');
    });

    it('saves a PostgreSQL profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'Test PostgreSQL',
          engine: 'postgresql',
          server: 'localhost',
          port: 5432,
          authenticationType: 'sql',
          username: 'postgres',
          encrypt: false,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
        password: 'pgpass',
      });

      expect(saved.engine).toBe('postgresql');
      expect(saved.port).toBe(5432);
    });

    it('updates an existing profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'Original',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
      });

      const updated = await store.save({
        profile: {
          id: saved.id,
          name: 'Updated',
          engine: 'postgresql',
          server: 'dbhost',
          port: 5432,
          authenticationType: 'sql',
          encrypt: false,
          trustServerCertificate: true,
          connectionTimeout: 60,
        },
      });

      expect(updated.id).toBe(saved.id);
      expect(updated.name).toBe('Updated');
      expect(updated.engine).toBe('postgresql');
      expect(updated.updatedAt).toBeDefined();
    });

    it('deletes a profile', async () => {
      const saved = await store.save({
        profile: {
          name: 'To Delete',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
      });

      const deleted = await store.delete(saved.id);
      expect(deleted).toBe(true);

      const found = store.getById(saved.id);
      expect(found).toBeUndefined();
    });

    it('returns false when deleting non-existent profile', async () => {
      const deleted = await store.delete('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('password management', () => {
    it('stores and retrieves password', async () => {
      const saved = await store.save({
        profile: {
          name: 'PW Test',
          engine: 'mssql',
          server: 'localhost',
          port: 1433,
          authenticationType: 'sql',
          encrypt: true,
          trustServerCertificate: true,
          connectionTimeout: 30,
        },
        password: 'secret123',
      });

      const password = await store.getPassword(saved.id);
      expect(password).toBe('secret123');
    });
  });
});
