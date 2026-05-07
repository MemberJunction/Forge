import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import type { ConnectionProfile, DatabaseInfo, AppState } from '@mj-forge/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { ExplorerStateService } from './explorer.state';
import { TabStateService } from './tab.state';
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
  private readonly tabState = inject(TabStateService);

  // Private backing fields. Public-facing readonly views below carry @deprecated tags
  // so external consumers see the warning while internal mirrors don't fire on every
  // self-reference. Phase 9 removes both the backing fields and their public views.
  private readonly _profiles = signal<ConnectionProfile[]>([]);
  private readonly _activeConnectionId = signal<string | null>(null);
  private readonly _connecting = signal(false);
  private readonly _databases = signal<DatabaseInfo[]>([]);
  private readonly _loadingDatabases = signal(false);
  private readonly _selectedDatabase = signal<string | null>(null);
  private readonly _connectionHealthy = signal(true);
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private _reconnecting = false;
  private readonly _databaseCache = new Map<string, DatabaseInfo[]>();

  // Multi-connection state (Phase 2 — additive). These are the authoritative answer
  // to "what is connected" once consumers migrate in Phases 4-8.
  private readonly _connectedProfileIds = signal<ReadonlySet<string>>(new Set());
  private readonly _databasesByConnection = signal<ReadonlyMap<string, DatabaseInfo[]>>(new Map());
  private readonly _selectedDatabaseByConnection = signal<ReadonlyMap<string, string | null>>(
    new Map()
  );
  private readonly _heartbeatByConnection = new Map<string, ReturnType<typeof setInterval>>();
  private readonly _healthByConnection = signal<ReadonlyMap<string, boolean>>(new Map());

  readonly profiles = this._profiles.asReadonly();
  /** @deprecated Use `focusedConnectionId` instead. Removed in Phase 9. */
  readonly activeConnectionId = this._activeConnectionId.asReadonly();
  readonly connecting = this._connecting.asReadonly();
  /** @deprecated Use `databasesFor(focusedConnectionId())` instead. Removed in Phase 9. */
  readonly databases = this._databases.asReadonly();
  readonly loadingDatabases = this._loadingDatabases.asReadonly();
  /** @deprecated Use `selectedDatabaseFor(focusedConnectionId())` instead. Removed in Phase 9. */
  readonly selectedDatabase = this._selectedDatabase.asReadonly();
  /** @deprecated Use `healthFor(focusedConnectionId())` instead. Removed in Phase 9. */
  readonly connectionHealthy = this._connectionHealthy.asReadonly();
  readonly connectedProfileIds = this._connectedProfileIds.asReadonly();

  /** @deprecated Use `profileFor(focusedConnectionId())` instead. Removed in Phase 9. */
  readonly activeProfile = computed(() => {
    const id = this._activeConnectionId();
    return this._profiles().find(p => p.id === id) ?? null;
  });

  readonly hasProfiles = computed(() => this._profiles().length > 0);

  // True when at least one connection is open. The sidebar tree visibility key.
  readonly hasAnyConnection = computed(() => this._connectedProfileIds().size > 0);

  // Focus is derived from the active query tab — never set directly. When the active
  // tab is null or non-query, focus is null and the cloud icon shows disconnected.
  readonly focusedConnectionId = computed(() => {
    const tab = this.tabState.activeTab();
    if (!tab || tab.type !== 'query') return null;
    return tab.connectionId ?? null;
  });

  readonly focusedDatabaseName = computed(() => {
    const tab = this.tabState.activeTab();
    if (!tab || tab.type !== 'query') return null;
    return tab.databaseName ?? null;
  });

  readonly profiles$ = toObservable(this.profiles);
  readonly isConnected$ = toObservable(this.hasAnyConnection);

  /** @deprecated No-arg form removed in Phase 9. Prefer `hasAnyConnection()`. */
  isConnected(): boolean;
  isConnected(connectionId: string): boolean;
  isConnected(connectionId?: string): boolean {
    if (connectionId === undefined) {
      return this.hasAnyConnection();
    }
    return this._connectedProfileIds().has(connectionId);
  }

  databasesFor(connectionId: string | null): DatabaseInfo[] {
    if (!connectionId) return [];
    return this._databasesByConnection().get(connectionId) ?? [];
  }

  selectedDatabaseFor(connectionId: string | null): string | null {
    if (!connectionId) return null;
    return this._selectedDatabaseByConnection().get(connectionId) ?? null;
  }

  healthFor(connectionId: string | null): boolean {
    if (!connectionId) return true;
    // Absent entry = treat as healthy (no heartbeat result yet).
    return this._healthByConnection().get(connectionId) ?? true;
  }

  profileFor(connectionId: string | null): ConnectionProfile | null {
    if (!connectionId) return null;
    return this._profiles().find(p => p.id === connectionId) ?? null;
  }

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
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string
  ): Promise<ConnectionProfile | null> {
    try {
      const savedProfile = await firstValueFrom(
        this.ipc.saveConnection(profile, password, sshPassword, sshPassphrase)
      );
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
      if (this._connectedProfileIds().has(profileId)) {
        await this.disconnect(profileId);
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

  async testConnection(
    profile: ConnectionProfile,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string
  ): Promise<boolean> {
    try {
      this._connecting.set(true);
      const result = await firstValueFrom(
        this.ipc.testConnection(profile, password, sshPassword, sshPassphrase)
      );
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
      // Old singleton-style clear — kept until consumers migrate (Phases 4-5).
      this._databases.set([]);
      this._selectedDatabase.set(null);
      await firstValueFrom(this.ipc.connect(profileId));
      this._activeConnectionId.set(profileId);
      this.addConnectedProfileId(profileId);
      this.setHealth(profileId, true);
      this.notification.success(`Connected to ${profile.name}`);
      await this.loadDatabases();
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

  // Disconnect the connection identified by `connectionId`. No default — calling
  // bare `disconnect()` is now a TypeScript compile error (spec scenario:
  // "Calling disconnect without an argument is a type error"). Other open
  // connections — heartbeats, caches, server nodes — are untouched.
  async disconnect(connectionId: string): Promise<void> {
    if (!this._connectedProfileIds().has(connectionId)) return;

    // Heartbeat is still a singleton in Phase 4 — only stop it when the id we
    // are disconnecting is the one the singleton timer is pinging. T7 replaces
    // this with a per-connection `stopHeartbeatFor(connectionId)` map lookup.
    if (this._activeConnectionId() === connectionId) {
      this.stopHeartbeat();
    }

    try {
      await firstValueFrom(this.ipc.disconnect(connectionId));
    } catch (error) {
      console.error('Error disconnecting:', error);
    }

    // Legacy globals point at the focused connection. Clear them only when
    // the disconnected id WAS the focused one — disconnecting a non-focused
    // server must leave the focused server's globals intact.
    if (this._activeConnectionId() === connectionId) {
      this._activeConnectionId.set(null);
      this._databases.set([]);
      this._selectedDatabase.set(null);
    }

    this.cleanupConnectionState(connectionId);
    this.notification.info('Disconnected');
    this.saveState();
  }

  async loadDatabases(): Promise<void> {
    const connectionId = this._activeConnectionId();
    if (!connectionId) return;

    try {
      this._loadingDatabases.set(true);
      const databases = await firstValueFrom(this.ipc.listDatabases(connectionId));
      this._databases.set(databases);
      this._databaseCache.set(connectionId, databases);
      this.setDatabasesFor(connectionId, databases);
    } catch (error) {
      this.notification.error('Failed to load databases');
      console.error('Failed to load databases:', error);
    } finally {
      this._loadingDatabases.set(false);
    }
  }

  /**
   * Get databases for any connection (cached, fetched on demand).
   * Used by per-tab database selectors that may reference non-active connections.
   */
  async getDatabasesForConnection(connectionId: string): Promise<DatabaseInfo[]> {
    const cached = this._databaseCache.get(connectionId);
    if (cached) return cached;

    const databases = await firstValueFrom(this.ipc.listDatabases(connectionId));
    this._databaseCache.set(connectionId, databases);
    this.setDatabasesFor(connectionId, databases);
    return databases;
  }

  clearDatabaseCache(connectionId: string): void {
    this._databaseCache.delete(connectionId);
    this.deleteDatabasesFor(connectionId);
  }

  selectDatabase(name: string | null): void {
    this._selectedDatabase.set(name);
    const focusId = this._activeConnectionId();
    if (focusId) {
      this.setSelectedDatabaseFor(focusId, name);
    }
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
        this.setHealth(connectionId, true);
      } catch {
        this._connectionHealthy.set(false);
        this.setHealth(connectionId, false);
        // Try to reconnect once, guarded against concurrent attempts
        this._reconnecting = true;
        try {
          await firstValueFrom(this.ipc.connect(connectionId));
          this._connectionHealthy.set(true);
          this.setHealth(connectionId, true);
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

  // Per-connection signal-map helpers — encapsulated to keep call sites linear.
  // Signals require a fresh reference to fire change detection; clone-on-write.

  private addConnectedProfileId(connectionId: string): void {
    this._connectedProfileIds.update(prev => {
      if (prev.has(connectionId)) return prev;
      const next = new Set(prev);
      next.add(connectionId);
      return next;
    });
  }

  private removeConnectedProfileId(connectionId: string): void {
    this._connectedProfileIds.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Set(prev);
      next.delete(connectionId);
      return next;
    });
  }

  private setDatabasesFor(connectionId: string, databases: DatabaseInfo[]): void {
    this._databasesByConnection.update(prev => {
      const next = new Map(prev);
      next.set(connectionId, databases);
      return next;
    });
  }

  private deleteDatabasesFor(connectionId: string): void {
    this._databasesByConnection.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }

  private setSelectedDatabaseFor(connectionId: string, name: string | null): void {
    this._selectedDatabaseByConnection.update(prev => {
      const next = new Map(prev);
      next.set(connectionId, name);
      return next;
    });
  }

  private deleteSelectedDatabaseFor(connectionId: string): void {
    this._selectedDatabaseByConnection.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }

  private setHealth(connectionId: string, healthy: boolean): void {
    this._healthByConnection.update(prev => {
      const next = new Map(prev);
      next.set(connectionId, healthy);
      return next;
    });
  }

  private deleteHealth(connectionId: string): void {
    this._healthByConnection.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }

  // Strictly per-connection teardown — touches only the targeted id's state.
  // Legacy singleton clears live in `disconnect()` itself, gated on whether
  // the disconnected id was the focused one. Both happy and error paths in
  // `disconnect()` route here so per-connection resources never leak.
  private cleanupConnectionState(connectionId: string): void {
    this.removeConnectedProfileId(connectionId);
    this.clearDatabaseCache(connectionId);
    this.deleteSelectedDatabaseFor(connectionId);
    this.deleteHealth(connectionId);
    this.stopHeartbeatFor(connectionId);
    this.explorerState.removeServerNode(connectionId);
  }

  // Per-connection heartbeat teardown. Phase 2 leaves _heartbeatByConnection empty;
  // T7 will populate it via startHeartbeatFor(). Calling this on an absent key no-ops.
  private stopHeartbeatFor(connectionId: string): void {
    const handle = this._heartbeatByConnection.get(connectionId);
    if (!handle) return;
    clearInterval(handle);
    this._heartbeatByConnection.delete(connectionId);
  }
}
