/**
 * Connection-related type definitions
 */

export type DatabaseEngine = 'mssql' | 'postgresql' | 'mysql';
export type AuthenticationType = 'sql' | 'windows' | 'entra-id';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Default ports for each database engine */
export const DEFAULT_PORTS: Record<DatabaseEngine, number> = {
  mssql: 1433,
  postgresql: 5432,
  mysql: 3306,
};

/** Human-readable labels for each database engine */
export const ENGINE_LABELS: Record<DatabaseEngine, string> = {
  mssql: 'SQL Server',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
};

export interface VolumeMapping {
  hostPath: string;
  containerPath: string;
}

export type SshAuthType = 'password' | 'privateKey';

export interface SshTunnelConfig {
  enabled: boolean;
  host: string;
  port: number; // default 22
  username: string;
  authType: SshAuthType;
  privateKeyPath?: string; // only for authType === 'privateKey'
}

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: DatabaseEngine;
  server: string; // hostname or IP
  port: number;
  authenticationType: AuthenticationType;
  username?: string;
  // Note: password is stored in Keychain, never in profile
  database?: string; // default database
  encrypt: boolean;
  trustServerCertificate: boolean;
  connectionTimeout: number;
  requestTimeout?: number;
  color?: string; // optional accent color for visual identification
  isDocker?: boolean;
  dockerContainerId?: string;
  volumeMappings?: VolumeMapping[];
  sshTunnel?: SshTunnelConfig;
  azureTenantId?: string; // Entra ID tenant (directory) ID — pins login to a specific tenant
  azureClientId?: string; // Entra ID application (client) ID — override the default well-known client
  azureHomeAccountId?: string; // MSAL homeAccountId — binds silent refresh to the specific account this profile signs in as
  mysqlCollation?: string; // e.g. 'utf8mb4_0900_ai_ci'
  /**
   * True when this profile is auto-managed by the MJ Dev Manager (it points at
   * the shared SQL Server backing the workspace's instances and is reconciled
   * from `server.json` on launch). Used to find + refresh the one managed
   * profile without duplicating it, and lets the UI distinguish it from
   * user-created connections. User edits to name/color are preserved across
   * reconciles; host/port/credentials are refreshed.
   */
  managed?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TestConnectionResult {
  success: boolean;
  serverVersion?: string;
  serverName?: string;
  error?: string;
  errorCode?: string;
  guidance?: string[];
}

export interface SaveConnectionRequest {
  profile: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };
  password?: string;
  sshPassword?: string;
  sshPassphrase?: string;
}

export interface ActiveConnection {
  id: string;
  profile: ConnectionProfile;
  status: ConnectionStatus;
  connectedAt?: string;
  currentDatabase?: string;
}

// Legacy aliases for backward compatibility
export type AuthType = AuthenticationType;
export type ConnectionTestRequest = Omit<
  ConnectionProfile,
  'id' | 'name' | 'createdAt' | 'updatedAt'
> & { password?: string };
export type ConnectionTestResult = TestConnectionResult;
export interface ConnectionError {
  code: string;
  message: string;
  guidance: string[];
}
