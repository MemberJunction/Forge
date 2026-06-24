import type { ServerRecord } from '@mj-forge/shared';
import type { DockerManager } from './DockerManager.js';
import type { InstanceStore } from './InstanceStore.js';
import type { ResolvedPaths } from './paths.js';
import { PortAllocator } from './PortAllocator.js';
import { emit, type EventSink, generatePassword, noopSink } from './util.js';

/**
 * Owns the workspace's ONE shared SQL Server container — the single SQL Server
 * that hosts every instance's database (`MJ_<slug>`). This replaces the old
 * per-instance container model: SQL Server natively serves many databases, so a
 * single server eliminates per-instance port allocation, container/RAM overhead,
 * and (counter-intuitively) the cross-container CPU/IO contention that caused
 * migration timeouts when several servers competed on one host.
 *
 * Dev/prod isolation is preserved for free: the server's coordinates live in
 * `server.json` inside the already-prefix-isolated config dir (`~/.mjdev` vs
 * `~/.mjdev-dev`), and the container is named per prefix (`mjdev-sql` vs
 * `mjdev-dev-sql`) on its own auto-allocated port. Dev work therefore never
 * touches the production server other agents rely on.
 *
 * Credentials are shared across the server (the login *names* are fixed, so a
 * single password per login is the only coherent model); per-instance databases,
 * users, encryption keys, and API keys keep an instance's data and auth distinct.
 */
export class SharedSqlServer {
  constructor(
    private readonly docker: DockerManager,
    private readonly store: InstanceStore,
    private readonly paths: ResolvedPaths
  ) {}

  /**
   * Ensure the shared SQL Server exists, is running, and is accepting logins;
   * return its record. Idempotent — creates + records it on first call (choosing
   * a free host port and generating the shared credentials once), starts it if
   * stopped, and otherwise just confirms readiness. Never destroys the container
   * or its volume: every instance's data lives there.
   */
  async ensure(sink: EventSink = noopSink): Promise<ServerRecord> {
    let server = await this.store.getServer();
    if (!server) {
      // Avoid colliding with any published Docker port — notably the *other*
      // workspace's shared server (prod's `:1433` while we're dev), so dev lands
      // on the next free port automatically.
      const reserved = await this.docker.listPublishedHostPorts().catch(() => []);
      const port = await PortAllocator.allocateServerPort(reserved);
      server = {
        containerName: `${this.paths.containerPrefix}-sql`,
        volume: `${this.paths.containerPrefix}-sql-data`,
        port,
        // `sa` is bootstrap/admin only — app access uses the least-privilege
        // shared logins below (see dbBootstrap.ts). All three are generated once
        // and pinned in server.json: MSSQL_SA_PASSWORD only applies to a fresh
        // volume, and the shared login names mean the first CREATE LOGIN wins.
        saPassword: generatePassword(),
        dbPassword: generatePassword(),
        codegenPassword: generatePassword(),
      };
      await this.store.setServer(server);
    }

    const id = await this.docker.ensureServerContainer(
      {
        name: server.containerName,
        volume: server.volume,
        hostPort: server.port,
        saPassword: server.saPassword,
      },
      sink
    );
    await this.docker.waitHealthy(server.containerName, server.saPassword, sink);
    emit(
      sink,
      server.containerName,
      'docker',
      'info',
      `Shared SQL Server ready (id ${id.slice(0, 12)})`
    );
    return server;
  }
}
