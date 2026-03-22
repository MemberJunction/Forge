import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import type { ConnectionProfile, DatabaseInfo, AppState } from '@mj-forge/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { ExplorerStateService } from './explorer.state';
import { firstValueFrom } from 'rxjs';

export interface ConnectionState {
  profiles: ConnectionProfile[];
  activeConnectionId: string | null;
  connecting: boolean;
  databases: DatabaseInfo[];
  loadingDatabases: boolean;
  selectedDatabase: string | null;
}

@Injectable({ providedIn: 'root' })
export class ConnectionStateService {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  private readonly explorerState = inject(ExplorerStateService);

  // State signals
  private readonly _profiles = signal<ConnectionProfile[]>([]);
  private readonly _activeConnectionId = signal<string | null>(null);
  private readonly _connecting = signal(false);
  private readonly _databases = signal<DatabaseInfo[]>([]);
  private readonly _loadingDatabases = signal(false);
  private readonly _selectedDatabase = signal<string | null>(null);
  private readonly _connectionHealthy = signal(true);
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private _reconnecting = false;

  // Public readonly signals
  readonly profiles = this._profiles.asReadonly();
  readonly activeConnectionId = this._activeConnectionId.asReadonly();
  readonly connecting = this._connecting.asReadonly();
  readonly databases = this._databases.asReadonly();
  readonly loadingDatabases = this._loadingDatabases.asReadonly();
  readonly selectedDatabase = this._selectedDatabase.asReadonly();
  readonly connectionHealthy = this._connectionHealthy.asReadonly();

  // Computed signals
  readonly activeProfile = computed(() => {
    const id = this._activeConnectionId();
    return this._profiles().find(p => p.id === id) ?? null;
  });

  readonly isConnected = computed(() => this._activeConnectionId() !== null);

  readonly hasProfiles = computed(() => this._profiles().length > 0);

  // Observable versions for components that need them
  readonly profiles$ = toObservable(this.profiles);
  readonly activeProfile$ = toObservable(this.activeProfile);
  readonly isConnected$ = toObservable(this.isConnected);

  async loadProfiles(): Promise<void> {
    try {
      const profiles = await firstValueFrom(this.ipc.listConnections());
      this._profiles.set(profiles);
    } catch (error) {
      this.notification.error('Failed to load connection profiles');
      console.error('Failed to load profiles:', error);
    }
  }

  async saveProfile(
    profile: Partial<ConnectionProfile>,
    password?: string
  ): Promise<ConnectionProfile | null> {
    try {
      const savedProfile = await firstValueFrom(this.ipc.saveConnection(profile, password));
      await this.loadProfiles();
      this.notification.success('Connection saved successfully');
      return savedProfile;
    } catch (error) {
      this.notification.error('Failed to save connection');
      console.error('Failed to save profile:', error);
      return null;
    }
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    try {
      // Disconnect if this is the active connection
      if (this._activeConnectionId() === profileId) {
        await this.disconnect();
      }
      await firstValueFrom(this.ipc.deleteConnection(profileId));
      await this.loadProfiles();
      this.notification.success('Connection deleted');
      return true;
    } catch (error) {
      this.notification.error('Failed to delete connection');
      console.error('Failed to delete profile:', error);
      return false;
    }
  }

  async testConnection(profile: ConnectionProfile, password?: string): Promise<boolean> {
    try {
      this._connecting.set(true);
      const result = await firstValueFrom(this.ipc.testConnection(profile, password));
      if (result.success) {
        this.notification.success(`Connected to ${result.serverVersion || 'SQL Server'}`);
        return true;
      } else {
        this.notification.error(result.error || 'Connection failed');
        return false;
      }
    } catch (error) {
      this.notification.error('Connection test failed');
      console.error('Connection test failed:', error);
      return false;
    } finally {
      this._connecting.set(false);
    }
  }

  async connect(profileId: string): Promise<boolean> {
    const profile = this._profiles().find(p => p.id === profileId);
    if (!profile) {
      this.notification.error('Connection profile not found');
      return false;
    }

    try {
      this._connecting.set(true);
      await firstValueFrom(this.ipc.connect(profileId));
      this._activeConnectionId.set(profileId);
      this.notification.success(`Connected to ${profile.name}`);
      await this.loadDatabases();
      // Save connection state for persistence
      this.saveState();
      this.startHeartbeat();
      return true;
    } catch (error) {
      this.notification.error('Failed to connect');
      console.error('Failed to connect:', error);
      return false;
    } finally {
      this._connecting.set(false);
    }
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    const connectionId = this._activeConnectionId();
    if (!connectionId) return;

    try {
      await firstValueFrom(this.ipc.disconnect(connectionId));
      this._activeConnectionId.set(null);
      this._databases.set([]);
      this._selectedDatabase.set(null);
      this.explorerState.removeServerNode(connectionId);
      this.notification.info('Disconnected');
      // Clear saved connection state
      this.saveState();
    } catch (error) {
      console.error('Error disconnecting:', error);
      // Still clear state even if disconnect fails
      this._activeConnectionId.set(null);
      this._databases.set([]);
      this._selectedDatabase.set(null);
      this.explorerState.removeServerNode(connectionId);
    }
  }

  async loadDatabases(): Promise<void> {
    const connectionId = this._activeConnectionId();
    if (!connectionId) return;

    try {
      this._loadingDatabases.set(true);
      const databases = await firstValueFrom(this.ipc.listDatabases(connectionId));
      this._databases.set(databases);
    } catch (error) {
      this.notification.error('Failed to load databases');
      console.error('Failed to load databases:', error);
    } finally {
      this._loadingDatabases.set(false);
    }
  }

  selectDatabase(name: string | null): void {
    this._selectedDatabase.set(name);
    // Save database selection for persistence
    this.saveState();
  }

  getProfile(id: string): ConnectionProfile | undefined {
    return this._profiles().find(p => p.id === id);
  }

  /**
   * Initialize state from saved app state
   * Should be called on app startup
   */
  async restoreState(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const state = await firstValueFrom(this.ipc.getAppState());

      // Restore connection if there was one
      if (state.lastConnectionId) {
        // First ensure profiles are loaded
        if (this._profiles().length === 0) {
          await this.loadProfiles();
        }

        // Check if the profile still exists
        const profile = this._profiles().find(p => p.id === state.lastConnectionId);
        if (profile) {
          const connected = await this.connect(state.lastConnectionId);
          if (connected) {
            // Add server node to explorer and expand it
            this.explorerState.addServerNode(state.lastConnectionId, profile.name);
            this.explorerState.expandNode(`server-${state.lastConnectionId}`);

            // Select the last database if it exists
            if (state.lastDatabase) {
              if (this._databases().some(db => db.name === state.lastDatabase)) {
                this.selectDatabase(state.lastDatabase);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to restore connection state:', error);
      this.notification.warning('Could not restore previous connection');
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this._connectionHealthy.set(true);
    this._reconnecting = false;
    this._heartbeatInterval = setInterval(async () => {
      const connectionId = this._activeConnectionId();
      if (!connectionId || this._reconnecting) {
        if (!connectionId) this.stopHeartbeat();
        return;
      }
      try {
        await firstValueFrom(this.ipc.listDatabases(connectionId));
        this._connectionHealthy.set(true);
      } catch {
        this._connectionHealthy.set(false);
        // Try to reconnect once, guarded against concurrent attempts
        this._reconnecting = true;
        try {
          await firstValueFrom(this.ipc.connect(connectionId));
          this._connectionHealthy.set(true);
          this.notification.info('Connection restored');
        } catch {
          // Stay unhealthy, user can manually reconnect
        } finally {
          this._reconnecting = false;
        }
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  /**
   * Save current connection state
   */
  async saveState(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const stateUpdate: Partial<AppState> = {
        lastConnectionId: this._activeConnectionId(),
        lastDatabase: this._selectedDatabase(),
      };
      await firstValueFrom(this.ipc.setAppState(stateUpdate));
    } catch (error) {
      console.error('Failed to save connection state:', error);
    }
  }
}
