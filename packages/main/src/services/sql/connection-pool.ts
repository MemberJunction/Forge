/**
 * Connection Pool Manager
 * Manages database connection pools for multiple connections.
 * Supports SQL Server (mssql), PostgreSQL (pg), and MySQL (mysql2) engines.
 */

import { ConnectionPool, config as SqlConfig, IResult } from 'mssql';
import { Pool as PgPool } from 'pg';
import mysql from 'mysql2/promise';
import type { Pool as MySQLPool } from 'mysql2/promise';
import type { ConnectionProfile, TestConnectionResult, DatabaseEngine } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { ConnectionProfilesStore } from '../config/connection-profiles';
import { SshTunnelManager, type SshCredentials } from '../ssh/ssh-tunnel-manager';
import { getDialect, type SQLDialect } from './dialect';

const log = createLogger('PoolManager');

interface PoolEntry {
  pool: ConnectionPool;
  profileId: string;
  lastUsed: Date;
  activeQueries: number;
}

interface PgPoolEntry {
  pool: PgPool;
  profileId: string;
  lastUsed: Date;
  activeQueries: number;
}

interface MySQLPoolEntry {
  pool: MySQLPool;
  profileId: string;
  lastUsed: Date;
  activeQueries: number;
}

export class ConnectionPoolManager extends BaseSingleton {
  private pools: Map<string, PoolEntry> = new Map();
  private pgPools: Map<string, PgPoolEntry> = new Map();
  private mysqlPools: Map<string, MySQLPoolEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private profileStore: ConnectionProfilesStore;
  private sshTunnelManager: SshTunnelManager;

  constructor() {
    super();
    this.profileStore = ConnectionProfilesStore.getInstance();
    this.sshTunnelManager = SshTunnelManager.getInstance();
    this.startCleanupTimer();
  }

  /**
   * If the profile has SSH tunneling enabled, open a tunnel and return
   * a modified profile pointing at the local tunnel endpoint.
   * Otherwise, return the profile unchanged.
   */
  private async withTunnel(
    profile: ConnectionProfile,
    password?: string
  ): Promise<{ effectiveProfile: ConnectionProfile; tunnelOpened: boolean }> {
    if (!profile.sshTunnel?.enabled) {
      return { effectiveProfile: profile, tunnelOpened: false };
    }

    // For test connections (no real profile ID), use a temp key
    const tunnelKey = profile.id || `test-${Date.now()}`;

    // Store SSH credentials temporarily for test connections so tunnel manager can read them
    if (password !== undefined && profile.id === 'test-connection') {
      // For test connections, the SSH creds are passed through the profile store flow.
      // The tunnel manager reads from credential store, so we need them cached.
    }

    const endpoint = await this.sshTunnelManager.openTunnel(
      tunnelKey,
      profile.sshTunnel,
      profile.server,
      profile.port
    );

    return {
      effectiveProfile: { ...profile, server: endpoint.localHost, port: endpoint.localPort },
      tunnelOpened: true,
    };
  }

  private errMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * If the SSH tunnel for a profile has been evicted (e.g. ssh2 keepalive
   * detected a dead bastion connection and fired 'close'), all DB pools that
   * were tunneling through it are stale — even if their `.connected` flag
   * still reports true, since the OS hasn't yet noticed the local socket is
   * dead. Tear them down so the next get*Pool call rebuilds them on a fresh
   * tunnel.
   */
  private async invalidateStalePoolsIfTunnelGone(profile: ConnectionProfile): Promise<void> {
    if (!profile.sshTunnel?.enabled) return;
    if (this.sshTunnelManager.hasTunnel(profile.id)) return;

    // The "no tunnel for this profile" condition is also true on the very
    // first connection — we don't want to log "tunnel is gone" then. Collect
    // affected pools first; only proceed (and log) if there's something to
    // actually invalidate.
    const mssql = this.pools.get(profile.id);
    const pgEntries = [...this.pgPools.entries()].filter(
      ([key]) => key === profile.id || key.startsWith(`${profile.id}:`)
    );
    const mysqlEntries = [...this.mysqlPools.entries()].filter(
      ([key]) => key === profile.id || key.startsWith(`${profile.id}:`)
    );

    if (!mssql && pgEntries.length === 0 && mysqlEntries.length === 0) return;

    log.info(`SSH tunnel for ${profile.id} is gone — discarding stale pools`);

    if (mssql) {
      try {
        await mssql.pool.close();
      } catch (err) {
        log.warn(`Failed to close stale mssql pool: ${this.errMessage(err)}`);
      }
      this.pools.delete(profile.id);
    }

    for (const [key, entry] of pgEntries) {
      try {
        await entry.pool.end();
      } catch (err) {
        log.warn(`Failed to close stale pg pool ${key}: ${this.errMessage(err)}`);
      }
      this.pgPools.delete(key);
    }

    for (const [key, entry] of mysqlEntries) {
      try {
        await entry.pool.end();
      } catch (err) {
        log.warn(`Failed to close stale mysql pool ${key}: ${this.errMessage(err)}`);
      }
      this.mysqlPools.delete(key);
    }
  }

  /**
   * Get the SQL dialect for a connection profile
   */
  getDialectForProfile(profileId: string): SQLDialect {
    const profile = this.profileStore.getById(profileId);
    return getDialect(profile?.engine || 'mssql');
  }

  /**
   * Get the database engine for a connection profile
   */
  getEngineForProfile(profileId: string): DatabaseEngine {
    const profile = this.profileStore.getById(profileId);
    return profile?.engine || 'mssql';
  }

  /**
   * Test a connection without creating a persistent pool.
   * Routes to the correct engine-specific test method.
   * Opens a temporary SSH tunnel if configured, and tears it down afterward.
   */
  async testConnection(
    profile: ConnectionProfile,
    password?: string,
    sshCredentials?: SshCredentials
  ): Promise<TestConnectionResult> {
    log.info(`Testing ${profile.engine || 'mssql'} connection for profile: ${profile.name}`);
    log.debug(`Server: ${profile.server}:${profile.port}, User: ${profile.username}`);

    // Open SSH tunnel if configured (temporary, closed in finally)
    let tunnelKey: string | null = null;
    let effectiveProfile = profile;
    try {
      if (profile.sshTunnel?.enabled) {
        tunnelKey = `test-${Date.now()}`;
        const endpoint = await this.sshTunnelManager.openTunnel(
          tunnelKey,
          profile.sshTunnel,
          profile.server,
          profile.port,
          sshCredentials
        );
        effectiveProfile = { ...profile, server: endpoint.localHost, port: endpoint.localPort };
        log.info(`Test tunnel open on port ${endpoint.localPort}`);
      }

      if ((effectiveProfile.engine || 'mssql') === 'postgresql') {
        return await this.testPgConnection(effectiveProfile, password || '');
      }

      if ((effectiveProfile.engine || 'mssql') === 'mysql') {
        return await this.testMySQLConnection(effectiveProfile, password || '');
      }

      // Default: SQL Server
      return await this.testMssqlConnection(effectiveProfile, password || '');
    } catch (error) {
      // SSH tunnel errors surface here
      const err = error as Error;
      return {
        success: false,
        error: err.message,
        errorCode: 'SSH_TUNNEL_ERROR',
        guidance: ['Check your SSH tunnel settings', 'Verify the SSH host is reachable'],
      };
    } finally {
      if (tunnelKey) {
        try {
          await this.sshTunnelManager.closeTunnel(tunnelKey);
        } catch (err) {
          log.warn(`Failed to close test tunnel ${tunnelKey}: ${this.errMessage(err)}`);
        }
      }
    }
  }

  /**
   * Test a SQL Server connection
   */
  private async testMssqlConnection(
    profile: ConnectionProfile,
    password: string
  ): Promise<TestConnectionResult> {
    const config: SqlConfig = {
      server: profile.server,
      port: profile.port,
      user: profile.username,
      password,
      database: 'master',
      options: {
        encrypt: profile.encrypt,
        trustServerCertificate: profile.trustServerCertificate,
      },
      connectionTimeout: profile.connectionTimeout * 1000,
      requestTimeout: 10000,
    };

    log.debug(
      `Config: encrypt=${config.options?.encrypt}, trustCert=${config.options?.trustServerCertificate}`
    );

    let pool: ConnectionPool | null = null;

    try {
      pool = new ConnectionPool(config);
      log.debug('Attempting test connection...');
      await pool.connect();
      log.info('Test connection successful');

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
   * Test a PostgreSQL connection
   */
  private async testPgConnection(
    profile: ConnectionProfile,
    password: string
  ): Promise<TestConnectionResult> {
    let testPool: PgPool | null = null;
    try {
      testPool = new PgPool({
        host: profile.server,
        port: profile.port,
        user: profile.username,
        password,
        database: profile.database || 'postgres',
        ssl: profile.encrypt ? { rejectUnauthorized: !profile.trustServerCertificate } : false,
        connectionTimeoutMillis: profile.connectionTimeout * 1000,
        max: 1,
      });

      const client = await testPool.connect();
      const result = await client.query('SELECT version() AS version, current_database() AS name');
      client.release();

      const row = result.rows[0];
      return {
        success: true,
        serverVersion: row?.version?.split(',')[0] || 'Unknown',
        serverName: row?.name || 'Unknown',
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        success: false,
        error: err.message,
        errorCode: err.code || 'UNKNOWN',
        guidance: this.categorizePgError(err),
      };
    } finally {
      if (testPool) {
        try {
          await testPool.end();
        } catch (err) {
          log.warn(`Failed to close test pg pool: ${this.errMessage(err)}`);
        }
      }
    }
  }

  /**
   * Get a PostgreSQL pool for a profile.
   * PG sets database at the connection level, so a separate pool is created
   * per database. The pool key includes the database name.
   * All PG pools for a profile share the same SSH tunnel.
   */
  async getPgPool(profileId: string, database?: string): Promise<PgPool> {
    const profile = this.profileStore.getById(profileId);
    if (!profile) throw new Error('Connection profile not found');

    await this.invalidateStalePoolsIfTunnelGone(profile);

    const dbName = database || profile.database || 'postgres';
    const poolKey = `${profileId}:${dbName}`;

    const existing = this.pgPools.get(poolKey);
    if (existing) {
      existing.lastUsed = new Date();
      return existing.pool;
    }

    const password = await this.profileStore.getPassword(profileId);
    if (!password) throw new Error('Connection password not found in Keychain');

    // Open SSH tunnel if configured (reuses existing tunnel for this profileId)
    const { effectiveProfile } = await this.withTunnel(profile);

    const pool = new PgPool({
      host: effectiveProfile.server,
      port: effectiveProfile.port,
      user: effectiveProfile.username,
      password,
      database: dbName,
      ssl: effectiveProfile.encrypt
        ? { rejectUnauthorized: !effectiveProfile.trustServerCertificate }
        : false,
      connectionTimeoutMillis: effectiveProfile.connectionTimeout * 1000,
      query_timeout: (effectiveProfile.requestTimeout || 30) * 1000,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    // Verify connection
    const client = await pool.connect();
    client.release();

    this.pgPools.set(poolKey, {
      pool,
      profileId,
      lastUsed: new Date(),
      activeQueries: 0,
    });

    log.info(`Connected to PostgreSQL: ${profile.name}`);
    return pool;
  }

  /**
   * Test a MySQL connection
   */
  private async testMySQLConnection(
    profile: ConnectionProfile,
    password: string
  ): Promise<TestConnectionResult> {
    let testPool: MySQLPool | null = null;
    try {
      testPool = mysql.createPool({
        host: profile.server,
        port: profile.port,
        user: profile.username,
        password,
        database: profile.database || undefined,
        charset: profile.mysqlCollation || undefined,
        ssl: profile.encrypt ? { rejectUnauthorized: !profile.trustServerCertificate } : undefined,
        connectTimeout: profile.connectionTimeout * 1000,
        connectionLimit: 1,
      });

      const [rows] = await testPool.query('SELECT VERSION() AS version, DATABASE() AS name');
      const row = (rows as Record<string, unknown>[])[0];

      return {
        success: true,
        serverVersion: String(row?.version || 'Unknown'),
        serverName: String(row?.name || 'Unknown'),
      };
    } catch (error) {
      const err = error as Error & { code?: string };
      return {
        success: false,
        error: err.message,
        errorCode: err.code || 'UNKNOWN',
        guidance: this.categorizeMySQLError(err),
      };
    } finally {
      if (testPool) {
        try {
          await testPool.end();
        } catch (err) {
          log.warn(`Failed to close test mysql pool: ${this.errMessage(err)}`);
        }
      }
    }
  }

  /**
   * Get a MySQL pool for a profile.
   * MySQL supports USE for database switching, but we still create pools per
   * database for consistency with the PG pattern and connection isolation.
   * All MySQL pools for a profile share the same SSH tunnel.
   */
  async getMySQLPool(profileId: string, database?: string): Promise<MySQLPool> {
    const profile = this.profileStore.getById(profileId);
    if (!profile) throw new Error('Connection profile not found');

    await this.invalidateStalePoolsIfTunnelGone(profile);

    const dbName = database || profile.database || undefined;
    const poolKey = `${profileId}:${dbName ?? '__default__'}`;

    const existing = this.mysqlPools.get(poolKey);
    if (existing) {
      existing.lastUsed = new Date();
      return existing.pool;
    }

    const password = await this.profileStore.getPassword(profileId);
    if (!password) throw new Error('Connection password not found in Keychain');

    // Open SSH tunnel if configured (reuses existing tunnel for this profileId)
    const { effectiveProfile } = await this.withTunnel(profile);

    const pool = mysql.createPool({
      host: effectiveProfile.server,
      port: effectiveProfile.port,
      user: effectiveProfile.username,
      password,
      database: dbName,
      charset: profile.mysqlCollation || undefined,
      ssl: effectiveProfile.encrypt
        ? { rejectUnauthorized: !effectiveProfile.trustServerCertificate }
        : undefined,
      connectTimeout: effectiveProfile.connectionTimeout * 1000,
      connectionLimit: 10,
      waitForConnections: true,
      idleTimeout: 30000,
      multipleStatements: true,
    });

    // Verify connection
    const conn = await pool.getConnection();
    conn.release();

    this.mysqlPools.set(poolKey, {
      pool,
      profileId,
      lastUsed: new Date(),
      activeQueries: 0,
    });

    log.info(`Connected to MySQL: ${profile.name} (${dbName})`);
    return pool;
  }

  /**
   * Get or create a SQL Server connection pool for a profile.
   * Opens an SSH tunnel first if the profile has one configured.
   */
  async getPool(profileId: string): Promise<ConnectionPool> {
    log.debug(`Getting pool for profile: ${profileId}`);

    const profile = this.profileStore.getById(profileId);
    if (!profile) {
      log.error(`Profile not found: ${profileId}`);
      throw new Error('Connection profile not found');
    }

    // If the SSH tunnel died and got evicted, the cached pool is stale even if
    // it still reports connected. Drop it before checking for reuse.
    await this.invalidateStalePoolsIfTunnelGone(profile);

    // Check for existing connected pool
    const existing = this.pools.get(profileId);
    if (existing?.pool.connected) {
      log.debug(`Reusing existing pool for: ${profileId}`);
      existing.lastUsed = new Date();
      return existing.pool;
    }

    log.debug(`Creating new pool for: ${profileId}`);
    log.debug(`Found profile: "${profile.name}" at ${profile.server}:${profile.port}`);

    const password = await this.profileStore.getPassword(profileId);
    if (!password) {
      log.error(`Password not found in keychain for: ${profileId}`);
      throw new Error('Connection password not found in Keychain');
    }
    log.debug('Password retrieved from keychain');

    // Open SSH tunnel if configured
    const { effectiveProfile } = await this.withTunnel(profile);

    // Create new pool
    const config: SqlConfig = {
      server: effectiveProfile.server,
      port: effectiveProfile.port,
      user: effectiveProfile.username,
      password,
      database: effectiveProfile.database || 'master',
      options: {
        encrypt: effectiveProfile.encrypt,
        trustServerCertificate: effectiveProfile.trustServerCertificate,
      },
      connectionTimeout: effectiveProfile.connectionTimeout * 1000,
      requestTimeout: (effectiveProfile.requestTimeout || 30) * 1000,
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    log.debug(
      `Pool config: server=${config.server}:${config.port}, db=${config.database}, encrypt=${config.options?.encrypt}`
    );

    const pool = new ConnectionPool(config);
    log.info(`Connecting to ${effectiveProfile.server}:${effectiveProfile.port}...`);
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

      return (await request.batch(finalSql)) as IResult<T>;
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
   * Execute DDL statements on any engine (MSSQL or PostgreSQL).
   * Routes to the correct pool based on the connection's engine.
   */
  async executeDDL(profileId: string, sql: string, database?: string): Promise<void> {
    const engine = this.getEngineForProfile(profileId);

    if (engine === 'postgresql') {
      const pool = await this.getPgPool(profileId, database);
      const client = await pool.connect();
      try {
        await client.query(sql);
      } finally {
        client.release();
      }
      return;
    }

    if (engine === 'mysql') {
      const pool = await this.getMySQLPool(profileId, database);
      const conn = await pool.getConnection();
      try {
        await conn.query(sql);
      } finally {
        conn.release();
      }
      return;
    }

    // Default: SQL Server
    await this.batch(profileId, sql);
  }

  /**
   * Close a specific connection pool (SQL Server, PostgreSQL, or MySQL)
   * and its associated SSH tunnel if any.
   */
  async closePool(profileId: string): Promise<void> {
    const entry = this.pools.get(profileId);
    if (entry) {
      try {
        await entry.pool.close();
      } catch {
        /* ignore */
      }
      this.pools.delete(profileId);
    }

    // PG pools are keyed as "profileId:dbName", so close all pools for this profile
    for (const [key, pgEntry] of this.pgPools) {
      if (key === profileId || key.startsWith(`${profileId}:`)) {
        try {
          await pgEntry.pool.end();
        } catch {
          /* ignore */
        }
        this.pgPools.delete(key);
      }
    }

    // MySQL pools are keyed as "profileId:dbName", same pattern as PG
    for (const [key, mysqlEntry] of this.mysqlPools) {
      if (key === profileId || key.startsWith(`${profileId}:`)) {
        try {
          await mysqlEntry.pool.end();
        } catch {
          /* ignore */
        }
        this.mysqlPools.delete(key);
      }
    }

    // Close SSH tunnel for this profile
    await this.sshTunnelManager.closeTunnel(profileId);
  }

  /**
   * Close all connection pools (SQL Server + PostgreSQL)
   */
  async closeAll(): Promise<void> {
    const mssqlCloses = Array.from(this.pools.keys()).map(id => this.closePool(id));
    const pgCloses = Array.from(this.pgPools.keys()).map(async id => {
      const entry = this.pgPools.get(id);
      if (entry) {
        try {
          await entry.pool.end();
        } catch {
          /* ignore */
        }
        this.pgPools.delete(id);
      }
    });
    const mysqlCloses = Array.from(this.mysqlPools.keys()).map(async id => {
      const entry = this.mysqlPools.get(id);
      if (entry) {
        try {
          await entry.pool.end();
        } catch {
          /* ignore */
        }
        this.mysqlPools.delete(id);
      }
    });
    await Promise.all([...mssqlCloses, ...pgCloses, ...mysqlCloses]);
    await this.sshTunnelManager.closeAll();
  }

  /**
   * Check if a connection is active
   */
  isConnected(profileId: string): boolean {
    const mssqlEntry = this.pools.get(profileId);
    if (mssqlEntry?.pool.connected) return true;
    const pgEntry = this.pgPools.get(profileId);
    if (pgEntry != null) return true;
    // MySQL pools: check if any pool for this profile exists
    for (const key of this.mysqlPools.keys()) {
      if (key === profileId || key.startsWith(`${profileId}:`)) return true;
    }
    return false;
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
   * Categorize PostgreSQL connection errors for user-friendly messages
   */
  private categorizePgError(error: Error & { code?: string }): string[] {
    switch (error.code) {
      case 'ECONNREFUSED':
        return [
          'Check that PostgreSQL is running',
          'Verify the hostname and port are correct',
          'Check if a firewall is blocking the connection',
          'For Docker: ensure the container is running and port is exposed',
        ];
      case '28P01': // invalid_password
      case '28000': // invalid_authorization_specification
        return [
          'Check that the username is correct',
          'Check that the password is correct',
          'Ensure the user has CONNECT privilege on the database',
        ];
      case '3D000': // invalid_catalog_name
        return ['The specified database does not exist', 'Check the database name'];
      case 'ETIMEOUT':
        return [
          'The server took too long to respond',
          'Check network connectivity',
          'Try increasing the connection timeout',
        ];
      default:
        return ['Check the error details and try again'];
    }
  }

  /**
   * Categorize MySQL connection errors for user-friendly messages
   */
  private categorizeMySQLError(error: Error & { code?: string }): string[] {
    switch (error.code) {
      case 'ECONNREFUSED':
        return [
          'Check that MySQL is running',
          'Verify the hostname and port are correct',
          'Check if a firewall is blocking the connection',
          'For Docker: ensure the container is running and port is exposed',
        ];
      case 'ER_ACCESS_DENIED_ERROR':
        return [
          'Check that the username is correct',
          'Check that the password is correct',
          'Ensure the user has access from this host',
        ];
      case 'ER_BAD_DB_ERROR':
        return ['The specified database does not exist', 'Check the database name'];
      case 'ETIMEDOUT':
      case 'ECONNRESET':
        return [
          'The server took too long to respond',
          'Check network connectivity',
          'Try increasing the connection timeout',
        ];
      default:
        return ['Check the error details and try again'];
    }
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
          if (idleMs > 600000 && entry.activeQueries === 0) {
            // closePool wraps every step in try/catch internally — it cannot
            // reject — so `void` is safe here. For the direct pg/mysql end()
            // calls below, we attach a .catch handler because those CAN reject
            // (e.g. on a stale pool) and an unhandled rejection in this
            // setInterval callback would crash the Electron main process.
            void this.closePool(id);
          }
        }
        for (const [id, entry] of this.pgPools) {
          const idleMs = now.getTime() - entry.lastUsed.getTime();
          if (idleMs > 600000 && entry.activeQueries === 0) {
            entry.pool
              .end()
              .catch(err =>
                log.warn(`Failed to close idle pg pool ${id}: ${this.errMessage(err)}`)
              );
            this.pgPools.delete(id);
          }
        }
        for (const [id, entry] of this.mysqlPools) {
          const idleMs = now.getTime() - entry.lastUsed.getTime();
          if (idleMs > 600000 && entry.activeQueries === 0) {
            entry.pool
              .end()
              .catch(err =>
                log.warn(`Failed to close idle mysql pool ${id}: ${this.errMessage(err)}`)
              );
            this.mysqlPools.delete(id);
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
