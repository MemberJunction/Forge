/**
 * Connection-related type definitions
 */

export type AuthenticationType = 'sql' | 'windows' | 'azure-ad';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface VolumeMapping {
  hostPath: string;
  containerPath: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
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
