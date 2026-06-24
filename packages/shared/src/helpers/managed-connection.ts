import type { ConnectionProfile } from '../types/connection.types';
import type { ServerRecord } from '../types/instance.types';

/** Stable display name for the auto-managed MJ Dev shared-server connection. */
export const MANAGED_CONNECTION_NAME = 'MJ Dev (shared SQL Server)';

/** The profile shape accepted by a save (no id/timestamps — the store assigns them). */
export type ManagedConnectionProfile = Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Build the Forge connection profile for the workspace's shared SQL Server from
 * its {@link ServerRecord}. Pure — no Electron/store/keychain — so it's unit-
 * testable and reused by the startup reconciler.
 *
 * Connects as `sa` to the server itself (no default database) so the user can
 * browse/manage **every** `MJ_<slug>` database on it from one entry — `sa` is the
 * right level for a local dev-server management connection. The password is
 * passed separately to the store (kept in the keychain, never in the profile).
 *
 * `preserve` carries forward user-editable cosmetics (name/color) across a
 * reconcile; host/port/engine/credentials are always (re)derived from the record.
 */
export function buildManagedConnectionProfile(
  server: ServerRecord,
  preserve?: { name?: string; color?: string }
): ManagedConnectionProfile {
  return {
    name: preserve?.name ?? MANAGED_CONNECTION_NAME,
    engine: 'mssql',
    server: 'localhost',
    port: server.port,
    authenticationType: 'sql',
    username: 'sa',
    encrypt: false,
    // Matches the instances' own DB_TRUST_SERVER_CERTIFICATE=1 — the container's
    // cert is self-signed.
    trustServerCertificate: true,
    connectionTimeout: 15000,
    color: preserve?.color,
    managed: true,
  };
}
