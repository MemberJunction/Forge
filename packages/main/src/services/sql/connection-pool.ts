/**
 * Connection Pool Manager
 * Manages database connection pools for multiple connections.
 * Supports SQL Server (mssql), PostgreSQL (pg), and MySQL (mysql2) engines.
 */

import { ConnectionPool, config as SqlConfig, IResult } from 'mssql';
import { Pool as PgPool } from 'pg';
import mysql from 'mysql2/promise';
import type { Pool as MySQLPool } from 'mysql2/promise';
import { acquireTokenInteractive } from '../azure/entra-auth';
import type { ConnectionProfile, TestConnectionResult, DatabaseEngine } from '@mj-forge/shared';
import { BaseSingleton } from '../../utils/singleton';
import { createLogger } from '../../utils/logger';
import { ConnectionProfilesStore } from '../config/connection-profiles';
import { SshTunnelManager, type SshCredentials } from '../ssh/ssh-tunnel-manager';
import { getDialect, type SQLDialect } from './dialect';

const log = createLogger('PoolManager');

/**
 * Build the mssql config for a given profile and password.
 * Entra ID runs MSAL via loopback + system browser, pinned to the profile's
 * bound account (profile.azureHomeAccountId) so multi-account users don't
 * cross-contaminate profiles. onAccountBound is invoked with the resolved
 * homeAccountId whenever it changes from what the profile already had, so
 * the caller can persist it.
 */
async function buildMssqlConfig(
  profile: ConnectionProfile,
  password: string,
  database: string,
  timeouts: { connectionMs: number; requestMs: number },
  onAccountBound?: (homeAccountId: string) => Promise<void>
): Promise<SqlConfig> {
  const base: SqlConfig = {
    server: profile.server,
    port: profile.port,
    database,
    options: {
      encrypt: profile.encrypt,
      trustServerCertificate: profile.trustServerCertificate,
    },
    connectionTimeout: timeouts.connectionMs,
    requestTimeout: timeouts.requestMs,
  };

  if (profile.authenticationType === 'entra-id') {
    // Known v1 limitation: the access token is embedded statically into
    // the mssql config below. Azure AD tokens expire after 60–90 minutes,
    // and node-mssql/tedious has no callback for token refresh on
    // 'azure-active-directory-access-token'. Active connections keep
    // working past expiry, but new connections spawned by pool growth
    // (or after the 30s idle timeout) will fail auth. Workaround for
    // users: disconnect and reconnect; silent refresh from Keychain
    // makes that one click. Future fix: track expiry per pool and
    // recycle proactively, or invalidate on auth error and reconnect.
    log.info(
      `Acquiring Entra ID token (tenant=${profile.azureTenantId || 'organizations'}, boundAccount=${profile.azureHomeAccountId ?? '<none>'})...`
    );
    const { accessToken, homeAccountId } = await acquireTokenInteractive({
      tenantId: profile.azureTenantId,
      clientId: profile.azureClientId,
      homeAccountId: profile.azureHomeAccountId,
    });
    log.info(`Entra ID token acquired (length: ${accessToken.length})`);
    if (onAccountBound && homeAccountId !== profile.azureHomeAccountId) {
      await onAccountBound(homeAccountId);
    }
    return {
      ...base,
      authentication: {
        type: 'azure-active-directory-access-token' as const,
        options: { token: accessToken },
      },
    } as SqlConfig;
  }

  return {
    ...base,
    user: profile.username,
    password,
  };
}

function isEntraIdAuth(profile: ConnectionProfile): boolean {
  return profile.authenticationType === 'entra-id';
}

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
  // Cache: profileId → isAzureSQL. Cleared on disconnect.
  private azureCache: Map<string, boolean> = new Map();
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

  getProfileForId(profileId: string): ConnectionProfile | undefined {
    return this.profileStore.getById(profileId);
  }

  /**
   * Returns true when the connection is to Azure SQL Database (or Synapse).
   * Probes SERVERPROPERTY('EngineEdition') once per profile and caches the
   * result. Edition 5 = Azure SQL Database; 6 = Azure SQL Data Warehouse;
   * 8 = Azure SQL Managed Instance — we treat 5/6 as "Azure" since they
   * lack msdb. Managed Instance (8) HAS msdb, so it's treated as on-prem.
   * Non-mssql engines always return false.
   */
  async isAzureSQL(profileId: string): Promise<boolean> {
    const cached = this.azureCache.get(profileId);
    if (cached !== undefined) return cached;

    if (this.getEngineForProfile(profileId) !== 'mssql') {
      this.azureCache.set(profileId, false);
      return false;
    }

    // Use the base pool to probe (getPool without a database arg returns
    // the profileId-keyed pool, and resolveMssqlPoolKey shortcuts on
    // no-database so this doesn't recurse back into isAzureSQL).
    const pool = await this.getPool(profileId);
    const result = (await pool
      .request()
      .batch(`SELECT CAST(SERVERPROPERTY('EngineEdition') AS INT) AS edition`)) as IResult<{
      edition: number;
    }>;
    const edition = result.recordset[0]?.edition ?? 0;
    const isAzure = edition === 5 || edition === 6;
    this.azureCache.set(profileId, isAzure);
    log.info(`Engine edition for ${profileId}: ${edition} (isAzure=${isAzure})`);
    return isAzure;
  }

  /**
   * Compute the mssql pool key for (profileId, database). Used by getPool,
   * query, and batch so they all agree on which pool entry to look up
   * (preventing activeQueries-tracking drift). Per-DB keying is used only
   * for Azure SQL (where USE [db] is unsupported); on-prem SQL Server uses
   * a single base pool keyed at `profileId` with USE-switching at query time.
   */
  private async resolveMssqlPoolKey(profileId: string, database?: string): Promise<string> {
    if (!database) return profileId;
    const azure = await this.isAzureSQL(profileId);
    return azure ? `${profileId}:${database}` : profileId;
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
        await this.sshTunnelManager.closeTunnel(tunnelKey).catch(() => {});
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
    const testDb = profile.database || 'master';
    const config = await buildMssqlConfig(profile, password, testDb, {
      connectionMs: profile.connectionTimeout * 1000,
      requestMs: 10000,
    });

    log.debug(
      `Config: encrypt=${config.options?.encrypt}, trustCert=${config.options?.trustServerCertificate}, auth=${profile.authenticationType}`
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
        await testPool.end().catch(() => {});
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
        await testPool.end().catch(() => {});
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
  async getPool(profileId: string, database?: string): Promise<ConnectionPool> {
    const profile = this.profileStore.getById(profileId);
    if (!profile) {
      log.error(`Profile not found: ${profileId}`);
      throw new Error('Connection profile not found');
    }

    // Azure SQL Database requires per-database pools (USE [db] is not supported).
    // On-prem SQL Server uses a single base pool keyed at profileId with
    // USE-switching at query time. resolveMssqlPoolKey is the single source
    // of truth — query()/batch() use it too, so activeQueries tracking
    // always points at the right entry.
    const poolKey = await this.resolveMssqlPoolKey(profileId, database);

    log.debug(`Getting pool: key=${poolKey}`);

    const existing = this.pools.get(poolKey);
    if (existing?.pool.connected) {
      log.debug(`Reusing existing pool: ${poolKey}`);
      existing.lastUsed = new Date();
      return existing.pool;
    }

    log.debug(`Creating new pool: ${poolKey}`);

    const needsPassword = !isEntraIdAuth(profile);
    const password = needsPassword ? await this.profileStore.getPassword(profileId) : '';
    if (needsPassword && !password) {
      log.error(`Password not found in keychain for: ${profileId}`);
      throw new Error('Connection password not found in Keychain');
    }

    const { effectiveProfile } = await this.withTunnel(profile);

    // Per-DB pool key has the form 'profileId:database'; base pool key is
    // just profileId and connects to the profile's default database.
    const targetDb =
      poolKey === profileId ? effectiveProfile.database || 'master' : (database as string);
    const config: SqlConfig = {
      ...(await buildMssqlConfig(
        effectiveProfile,
        password || '',
        targetDb,
        {
          connectionMs: effectiveProfile.connectionTimeout * 1000,
          requestMs: (effectiveProfile.requestTimeout || 30) * 1000,
        },
        async homeAccountId => {
          const ok = await this.profileStore.setAzureHomeAccountId(profileId, homeAccountId);
          if (!ok)
            log.warn(`Failed to persist Entra account binding: profile ${profileId} not found`);
        }
      )),
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000,
      },
    };

    log.debug(
      `Pool config: server=${config.server}:${config.port}, db=${targetDb}, auth=${effectiveProfile.authenticationType}`
    );

    const pool = new ConnectionPool(config);
    await pool.connect();
    log.info(`Connected to ${profile.name} (db: ${targetDb})`);

    this.pools.set(poolKey, {
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
    const poolKey = await this.resolveMssqlPoolKey(profileId, database);
    const pool = await this.getPool(profileId, database);
    const finalSql = this.adaptSqlForPool(sql, poolKey, profileId, database);

    const entry = this.pools.get(poolKey);
    if (entry) entry.activeQueries++;

    try {
      return (await pool.request().batch(finalSql)) as IResult<T>;
    } finally {
      if (entry) {
        entry.activeQueries--;
        entry.lastUsed = new Date();
      }
    }
  }

  /**
   * Execute a batch of statements (for DDL operations).
   * If `database` is provided, routes via the same per-DB pool path the
   * `query` method uses, so DDL on Azure SQL targets the right database
   * (Azure has no USE support to fall back on).
   */
  async batch(profileId: string, sql: string, database?: string): Promise<void> {
    const poolKey = await this.resolveMssqlPoolKey(profileId, database);
    const pool = await this.getPool(profileId, database);
    const finalSql = this.adaptSqlForPool(sql, poolKey, profileId, database);

    const entry = this.pools.get(poolKey);
    if (entry) entry.activeQueries++;

    try {
      await pool.request().batch(finalSql);
    } finally {
      if (entry) {
        entry.activeQueries--;
        entry.lastUsed = new Date();
      }
    }
  }

  /**
   * Adjust the outgoing SQL to match the pool we're routing it to.
   *
   *  - On the on-prem path (poolKey === profileId), prepend `USE [db]` so
   *    a shared pool can switch database context per-query.
   *  - On the Azure path (poolKey === `${profileId}:${database}`), the pool
   *    is already connected to the right DB AND Azure SQL rejects USE
   *    outright. Strip any leading `USE [..];` the SQL generator embedded
   *    (TsqlBuilder.listSchemas/listTables/etc. all do) so those metadata
   *    queries actually run on Azure. The strip only touches a single
   *    leading USE statement; mid-query USEs (uncommon) are left alone.
   */
  private adaptSqlForPool(
    sql: string,
    poolKey: string,
    profileId: string,
    database?: string
  ): string {
    if (!database) return sql;

    if (poolKey === profileId) {
      const safeDb = database.replace(/\]/g, ']]');
      return `USE [${safeDb}];\n${sql}`;
    }

    // Azure per-DB pool: drop a single leading USE [..]; if present.
    // Bracket content allows escaped `]]` so DB names with `]` survive.
    return sql.replace(/^\s*USE\s+\[(?:[^\]]|\]\])*\]\s*;?\s*/i, '');
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
    await this.batch(profileId, sql, database);
  }

  /**
   * Close a specific connection pool (SQL Server, PostgreSQL, or MySQL)
   * and its associated SSH tunnel if any.
   */
  async closePool(profileId: string): Promise<void> {
    this.azureCache.delete(profileId);

    // MSSQL pools may be keyed as "profileId" (on-prem, single pool) or
    // "profileId:dbName" (Entra/Azure SQL per-database pools). Iterate so
    // both shapes are cleaned up — matches the PG/MySQL handling below.
    for (const [key, entry] of this.pools) {
      if (key === profileId || key.startsWith(`${profileId}:`)) {
        try {
          await entry.pool.close();
        } catch {
          /* ignore */
        }
        this.pools.delete(key);
      }
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

    // Clear cached Entra ID credential
    // Azure credential cache is keyed by server config, not profileId.
    // We keep it so reconnecting reuses the cached token without a browser popup.
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
    // MSSQL pools may be keyed as profileId (on-prem base) or
    // 'profileId:dbName' (Azure per-DB). Either counts as connected.
    for (const [key, entry] of this.pools) {
      if ((key === profileId || key.startsWith(`${profileId}:`)) && entry.pool.connected) {
        return true;
      }
    }
    // PG pools are keyed as 'profileId:dbName' too — match the same pattern.
    for (const [key, entry] of this.pgPools) {
      if (key === profileId || key.startsWith(`${profileId}:`)) {
        if (entry != null) return true;
      }
    }
    // MySQL pools: any pool for this profile counts.
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
            this.closePool(id).catch(() => {});
          }
        }
        // Also clean idle PG pools
        for (const [id, entry] of this.pgPools) {
          const idleMs = now.getTime() - entry.lastUsed.getTime();
          if (idleMs > 600000 && entry.activeQueries === 0) {
            entry.pool.end().catch(() => {});
            this.pgPools.delete(id);
          }
        }
        // Also clean idle MySQL pools
        for (const [id, entry] of this.mysqlPools) {
          const idleMs = now.getTime() - entry.lastUsed.getTime();
          if (idleMs > 600000 && entry.activeQueries === 0) {
            entry.pool.end().catch(() => {});
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
