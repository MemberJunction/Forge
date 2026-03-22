/**
 * Connection Pool Manager
 * Manages SQL Server connection pools for multiple connections
 */

import { ConnectionPool, config as SqlConfig, IResult } from 'mssql';
import type { ConnectionProfile, TestConnectionResult } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { ConnectionProfilesStore } from '../config/connection-profiles';

const log = createLogger('PoolManager');

interface PoolEntry {
  pool: ConnectionPool;
  profileId: string;
  lastUsed: Date;
  activeQueries: number;
}

export class ConnectionPoolManager extends BaseSingleton {
  private pools: Map<string, PoolEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private profileStore: ConnectionProfilesStore;

  constructor() {
    super();
    this.profileStore = ConnectionProfilesStore.getInstance();
    this.startCleanupTimer();
  }

  /**
   * Test a connection without creating a persistent pool
   */
  async testConnection(
    profile: ConnectionProfile,
    password?: string
  ): Promise<TestConnectionResult> {
    log.info(`Testing connection for profile: ${profile.name}`);
    log.debug(`Server: ${profile.server}:${profile.port}, User: ${profile.username}`);

    const config: SqlConfig = {
      server: profile.server,
      port: profile.port,
      user: profile.username,
      password: password || '',
      database: 'master',
      options: {
        encrypt: profile.encrypt,
        trustServerCertificate: profile.trustServerCertificate,
      },
      connectionTimeout: profile.connectionTimeout * 1000,
      requestTimeout: 10000,
    };

    log.debug(`Config: encrypt=${config.options?.encrypt}, trustCert=${config.options?.trustServerCertificate}`);

    let pool: ConnectionPool | null = null;

    try {
      pool = new ConnectionPool(config);
      log.debug('Attempting test connection...');
      await pool.connect();
      log.info('Test connection successful');

      // Get server info
      const result = await pool.request().query<{
        version: string;
        name: string;
      }>('SELECT @@VERSION as version, @@SERVERNAME as name');

      const row = result.recordset[0];

      return {
        success: true,
        serverVersion: row?.version?.split('\n')[0] || 'Unknown',
        serverName: row?.name || 'Unknown',
      };
    } catch (error) {
      const err = error as Error & { code?: string; number?: number };
      const categorized = this.categorizeError(err);
      return {
        success: false,
        error: categorized.message,
        errorCode: categorized.code,
        guidance: categorized.guidance,
      };
    } finally {
      if (pool) {
        try {
          await pool.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Get or create a connection pool for a profile
   */
  async getPool(profileId: string): Promise<ConnectionPool> {
    log.debug(`Getting pool for profile: ${profileId}`);

    // Check for existing connected pool
    const existing = this.pools.get(profileId);
    if (existing?.pool.connected) {
      log.debug(`Reusing existing pool for: ${profileId}`);
      existing.lastUsed = new Date();
      return existing.pool;
    }

    log.debug(`Creating new pool for: ${profileId}`);

    // Get profile and password
    const profile = this.profileStore.getById(profileId);
    if (!profile) {
      log.error(`Profile not found: ${profileId}`);
      throw new Error('Connection profile not found');
    }
    log.debug(`Found profile: "${profile.name}" at ${profile.server}:${profile.port}`);

    const password = await this.profileStore.getPassword(profileId);
    if (!password) {
      log.error(`Password not found in keychain for: ${profileId}`);
      throw new Error('Connection password not found in Keychain');
    }
    log.debug('Password retrieved from keychain');

    // Create new pool
    const config: SqlConfig = {
      server: profile.server,
      port: profile.port,
      user: profile.username,
      password,
      database: profile.database || 'master',
      options: {
        encrypt: profile.encrypt,
        trustServerCertificate: profile.trustServerCertificate,
      },
      connectionTimeout: profile.connectionTimeout * 1000,
      requestTimeout: (profile.requestTimeout || 30) * 1000,
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    log.debug(`Pool config: server=${config.server}:${config.port}, db=${config.database}, encrypt=${config.options?.encrypt}`);

    const pool = new ConnectionPool(config);
    log.info(`Connecting to ${profile.server}:${profile.port}...`);
    await pool.connect();
    log.info(`Connected to ${profile.name}`);

    this.pools.set(profileId, {
      pool,
      profileId,
      lastUsed: new Date(),
      activeQueries: 0,
    });

    return pool;
  }

  /**
   * Execute a query on a connection
   */
  async query<T>(profileId: string, sql: string, database?: string): Promise<IResult<T>> {
    const pool = await this.getPool(profileId);
    const entry = this.pools.get(profileId);

    if (entry) {
      entry.activeQueries++;
    }

    try {
      const request = pool.request();

      // Prepend USE [database] and execute as batch (raw T-SQL).
      // batch() is needed because query() uses sp_executesql which doesn't support USE.
      let finalSql = sql;
      if (database) {
        const safeDb = database.replace(/\]/g, ']]');
        finalSql = `USE [${safeDb}];\n${finalSql}`;
      }

      return await request.batch(finalSql) as IResult<T>;
    } finally {
      if (entry) {
        entry.activeQueries--;
        entry.lastUsed = new Date();
      }
    }
  }

  /**
   * Execute a batch of statements (for DDL operations)
   */
  async batch(profileId: string, sql: string): Promise<void> {
    const pool = await this.getPool(profileId);
    const entry = this.pools.get(profileId);

    if (entry) {
      entry.activeQueries++;
    }

    try {
      await pool.request().batch(sql);
    } finally {
      if (entry) {
        entry.activeQueries--;
        entry.lastUsed = new Date();
      }
    }
  }

  /**
   * Close a specific connection pool
   */
  async closePool(profileId: string): Promise<void> {
    const entry = this.pools.get(profileId);
    if (entry) {
      try {
        await entry.pool.close();
      } catch {
        // Ignore close errors
      }
      this.pools.delete(profileId);
    }
  }

  /**
   * Close all connection pools
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.pools.keys()).map(id => this.closePool(id));
    await Promise.all(closePromises);
  }

  /**
   * Check if a connection is active
   */
  isConnected(profileId: string): boolean {
    const entry = this.pools.get(profileId);
    return entry?.pool.connected ?? false;
  }

  /**
   * Categorize connection errors for user-friendly messages
   */
  private categorizeError(error: Error & { code?: string; number?: number }): {
    code: string;
    message: string;
    guidance: string[];
  } {
    const code = error.code || error.number?.toString() || 'UNKNOWN';
    const message = error.message;

    // SQL Server error numbers
    if (error.number === 18456) {
      return {
        code: 'AUTH_FAILED',
        message: 'Login failed',
        guidance: [
          'Check that the username is correct',
          'Check that the password is correct',
          'Ensure the login has permission to connect',
        ],
      };
    }

    if (error.code === 'ESOCKET' || error.code === 'ECONNREFUSED') {
      return {
        code: 'CONNECTION_REFUSED',
        message: 'Cannot connect to server',
        guidance: [
          'Check that SQL Server is running',
          'Verify the hostname and port are correct',
          'Check if a firewall is blocking the connection',
          'For Docker: ensure the container is running and port is exposed',
        ],
      };
    }

    if (error.code === 'ETIMEOUT') {
      return {
        code: 'TIMEOUT',
        message: 'Connection timed out',
        guidance: [
          'The server took too long to respond',
          'Check network connectivity',
          'Try increasing the connection timeout',
        ],
      };
    }

    if (message.includes('certificate')) {
      return {
        code: 'CERTIFICATE_ERROR',
        message: 'Certificate validation failed',
        guidance: [
          'Enable "Trust server certificate" for development servers',
          'For production, ensure the server has a valid certificate',
        ],
      };
    }

    return {
      code,
      message,
      guidance: ['Check the error details and try again'],
    };
  }

  /**
   * Start cleanup timer for idle connections
   */
  private startCleanupTimer(): void {
    // Clean up idle connections every 5 minutes
    this.cleanupInterval = setInterval(
      () => {
        const now = new Date();
        for (const [id, entry] of this.pools) {
          const idleMs = now.getTime() - entry.lastUsed.getTime();
          // Close connections idle for more than 10 minutes with no active queries
          if (idleMs > 600000 && entry.activeQueries === 0) {
            this.closePool(id).catch(() => {
              // Already handled inside closePool — guard against unexpected rejection
            });
          }
        }
      },
      5 * 60 * 1000
    );
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
