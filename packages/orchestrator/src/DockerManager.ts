import Dockerode from 'dockerode';
import type { InstanceRecord } from '@mj-forge/shared';
import { emit, type EventSink, noopSink } from './util.js';

const SQL_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest';
const SQL_INTERNAL_PORT = '1433/tcp';
const SQL_VOLUME_MOUNT = '/var/opt/mssql';
export const MANAGED_LABEL = 'mjdev.managed';
export const SLUG_LABEL = 'mjdev.slug';

/**
 * Owns the SQL Server container lifecycle for instances via dockerode. Tags
 * every container/volume with `mjdev.managed=true` + `mjdev.slug=<slug>` so the
 * tool can rediscover and reconcile them on launch.
 */
export class DockerManager {
  private readonly docker: Dockerode;

  constructor(docker?: Dockerode) {
    // Match Forge's detector default; allow injection for tests/cross-platform.
    this.docker = docker ?? new Dockerode({ socketPath: '/var/run/docker.sock' });
  }

  /** Throw a clear error if the Docker daemon isn't reachable. */
  async assertAvailable(): Promise<void> {
    try {
      await this.docker.ping();
    } catch {
      throw new Error('Docker does not appear to be running. Start Docker Desktop and retry.');
    }
  }

  private async ensureImage(slug: string, sink: EventSink): Promise<void> {
    const images = await this.docker.listImages({ filters: { reference: [SQL_IMAGE] } });
    if (images.length > 0) return;
    emit(sink, slug, 'docker', 'progress', `Pulling ${SQL_IMAGE} (first run only)…`);
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(SQL_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
      });
    });
    emit(sink, slug, 'docker', 'success', 'Image ready');
  }

  /**
   * Create and start the SQL Server container for an instance. Idempotent:
   * if a container with the same name already exists it is reused/started.
   */
  async createSqlContainer(
    record: InstanceRecord,
    saPassword: string,
    sink: EventSink = noopSink
  ): Promise<string> {
    await this.ensureImage(record.slug, sink);
    // A same-named container/volume here is an orphan from a prior failed attempt.
    // It must be cleared: MSSQL_SA_PASSWORD only applies to a fresh data volume,
    // so reusing a stale volume would keep an old, unknown sa password.
    const existing = await this.findByName(record.container.name);
    if (existing) {
      emit(sink, record.slug, 'docker', 'warn', 'Removing orphaned container from a prior attempt');
      await this.remove(record.container.name, record.container.volume);
    }

    emit(sink, record.slug, 'docker', 'progress', `Creating container ${record.container.name}…`);
    const container = await this.docker.createContainer({
      name: record.container.name,
      Image: SQL_IMAGE,
      Env: ['ACCEPT_EULA=Y', `MSSQL_SA_PASSWORD=${saPassword}`, 'MSSQL_PID=Developer'],
      Labels: { [MANAGED_LABEL]: 'true', [SLUG_LABEL]: record.slug },
      ExposedPorts: { [SQL_INTERNAL_PORT]: {} },
      HostConfig: {
        PortBindings: { [SQL_INTERNAL_PORT]: [{ HostPort: String(record.ports.sql) }] },
        Mounts: [
          {
            Type: 'volume',
            Source: record.container.volume,
            Target: SQL_VOLUME_MOUNT,
          },
        ],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    });
    await container.start();
    emit(sink, record.slug, 'docker', 'success', `Container started (SQL on :${record.ports.sql})`);
    return container.id;
  }

  /**
   * Wait until SQL Server can actually authenticate a login — runs `SELECT 1`
   * via sqlcmd *inside* the container in a retry loop. A host-side TCP probe is
   * insufficient: Docker's port proxy accepts connections before SQL Server is
   * ready for logins, producing false-positive readiness.
   */
  async waitHealthy(
    record: InstanceRecord,
    saPassword: string,
    sink: EventSink = noopSink,
    timeoutMs = 180_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    emit(sink, record.slug, 'docker', 'progress', 'Waiting for SQL Server to accept logins…');
    let lastOutput = '';
    while (Date.now() < deadline) {
      const { code, output } = await this.runSqlcmd(record.container.name, saPassword, 'SELECT 1');
      if (code === 0) {
        emit(sink, record.slug, 'docker', 'success', 'SQL Server is ready for logins');
        return;
      }
      lastOutput = output;
      await delay(3000);
    }
    const tail = lastOutput.trim().split('\n').slice(-4).join('\n');
    throw new Error(
      `SQL Server did not become ready within ${Math.round(timeoutMs / 1000)}s. ` +
        `Check logs: docker logs ${record.container.name}${tail ? `\n${tail}` : ''}`
    );
  }

  /**
   * Run a SQL script inside the container via `sqlcmd` as `sa`. Throws on a
   * non-zero exit. Script + sa password are passed as env vars (never
   * argv/shell-interpolated) so arbitrary content is safe.
   */
  async execSql(
    name: string,
    saPassword: string,
    sql: string,
    slug: string,
    sink: EventSink = noopSink
  ): Promise<void> {
    const { code, output } = await this.runSqlcmd(name, saPassword, sql);
    const tail = output.trim().split('\n').slice(-6).join('\n');
    if (code !== 0) {
      emit(sink, slug, 'docker', 'error', tail || 'sqlcmd failed');
      throw new Error(`Database setup failed (sqlcmd exit ${code}): ${tail}`);
    }
    emit(sink, slug, 'docker', 'success', 'Database, logins, and roles created');
  }

  /** Run sqlcmd inside the container, returning exit code + combined output. */
  private async runSqlcmd(
    name: string,
    saPassword: string,
    sql: string
  ): Promise<{ code: number; output: string }> {
    // Locate sqlcmd across image variants (tools18 / tools); trust dev cert (-C),
    // stop on error (-b), bounded login timeout (-l). Args via env to avoid quoting.
    const command =
      'for p in "$(command -v sqlcmd)" /opt/mssql-tools18/bin/sqlcmd /opt/mssql-tools/bin/sqlcmd; do ' +
      '[ -x "$p" ] && SQLCMD="$p" && break; done; ' +
      '"$SQLCMD" -S localhost -U sa -P "$SA_PASSWORD" -C -b -l 5 -Q "$SETUP_SQL"';
    return this.execInContainer(name, [`SA_PASSWORD=${saPassword}`, `SETUP_SQL=${sql}`], command);
  }

  /** Exec a bash command inside the named container; returns exit code + output. */
  private async execInContainer(
    name: string,
    env: string[],
    shellCommand: string
  ): Promise<{ code: number; output: string }> {
    const c = await this.findByName(name);
    if (!c) throw new Error(`Container ${name} not found`);
    const container = this.docker.getContainer(c.Id);
    const exec = await container.exec({
      Cmd: ['/bin/bash', '-c', shellCommand],
      Env: env,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const output = await new Promise<string>((resolve, reject) => {
      exec.start({ Tty: true }, (err, stream) => {
        if (err || !stream) return reject(err ?? new Error('Failed to start exec'));
        let buf = '';
        stream.on('data', (d: Buffer) => {
          buf += d.toString();
        });
        stream.on('end', () => resolve(buf));
        stream.on('error', reject);
      });
    });
    const info = await exec.inspect();
    return { code: info.ExitCode ?? -1, output };
  }

  async start(name: string): Promise<void> {
    const c = await this.findByName(name);
    if (!c) throw new Error(`Container ${name} not found`);
    if (c.State !== 'running') await this.docker.getContainer(c.Id).start();
  }

  async stop(name: string): Promise<void> {
    const c = await this.findByName(name);
    if (c && c.State === 'running') await this.docker.getContainer(c.Id).stop();
  }

  /** Stop+remove the container and (optionally) its data volume. */
  async remove(name: string, volume?: string): Promise<void> {
    const c = await this.findByName(name);
    if (c) {
      const container = this.docker.getContainer(c.Id);
      try {
        await container.stop();
      } catch {
        /* already stopped */
      }
      await container.remove({ force: true });
    }
    if (volume) {
      try {
        await this.docker.getVolume(volume).remove({ force: true });
      } catch {
        /* volume may not exist */
      }
    }
  }

  /** Container runtime state, or undefined if it doesn't exist. */
  async getState(name: string): Promise<string | undefined> {
    return (await this.findByName(name))?.State;
  }

  /** All containers this tool manages, keyed by slug. */
  async listManaged(): Promise<Array<{ slug: string; name: string; state: string }>> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${MANAGED_LABEL}=true`] },
    });
    return containers.map(c => ({
      slug: c.Labels[SLUG_LABEL] ?? '',
      name: (c.Names[0] ?? '').replace(/^\//, ''),
      state: c.State,
    }));
  }

  /** Host ports currently published by ANY Docker container (managed or not). */
  async listPublishedHostPorts(): Promise<number[]> {
    const containers = await this.docker.listContainers({ all: false });
    const ports = new Set<number>();
    for (const c of containers) {
      for (const p of c.Ports ?? []) {
        if (p.PublicPort) ports.add(p.PublicPort);
      }
    }
    return [...ports];
  }

  private async findByName(name: string): Promise<Dockerode.ContainerInfo | undefined> {
    const containers = await this.docker.listContainers({ all: true, filters: { name: [name] } });
    // Docker name filter is a substring match; require an exact match on the leading-slash form.
    return containers.find(c => c.Names.some(n => n === `/${name}`));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
