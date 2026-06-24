/**
 * Auto-register a Forge connection for the MJ Dev Manager's shared SQL Server.
 *
 * Instances no longer each get their own container — a workspace runs ONE shared
 * SQL Server (recorded in `~/.mjdev/server.json`) hosting every `MJ_<slug>`
 * database. This reconciler reads that record on launch and upserts a single
 * managed `ConnectionProfile` pointing at it, so the server (and all its
 * databases) shows up in Forge's connection list with no manual setup.
 *
 * Idempotent + non-destructive: it owns exactly the one profile tagged
 * `managed: true`, refreshes its host/port/credentials from the record, and
 * preserves any name/color the user changed. Best-effort — never throws into
 * startup.
 */
import { resolvePaths, InstanceStore } from '@mj-forge/orchestrator';
import { buildManagedConnectionProfile } from '@mj-forge/shared';
import { ConnectionProfilesStore } from './config/connection-profiles';
import { createLogger } from '../utils/logger';

const log = createLogger('MjdevConnections');

export async function reconcileManagedConnections(): Promise<void> {
  try {
    const paths = resolvePaths({});
    const server = await new InstanceStore(paths).getServer();
    if (!server) {
      log.debug('No shared SQL Server recorded yet — nothing to reconcile');
      return;
    }

    const store = ConnectionProfilesStore.getInstance();
    // We own the single profile tagged managed that points at our shared server.
    const existing = store
      .getAll()
      .find(p => p.managed && p.engine === 'mssql' && p.server === 'localhost');

    const profile = buildManagedConnectionProfile(
      server,
      existing ? { name: existing.name, color: existing.color } : undefined
    );

    await store.save({
      profile: existing ? { ...profile, id: existing.id } : profile,
      password: server.saPassword,
    });

    log.info(
      `Reconciled managed connection → localhost:${server.port} (${existing ? 'updated' : 'created'})`
    );
  } catch (err) {
    log.warn(
      `Failed to reconcile managed mjdev connection: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
