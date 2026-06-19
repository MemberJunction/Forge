import * as net from 'node:net';
import type { InstancePorts } from '@mj-forge/shared';

/** Base port for each role; instance N gets base + STRIDE * N. */
const BASES = { sql: 1433, api: 4000, explorer: 4200 } as const;
const STRIDE = 10;
const MAX_PROBES = 200;

/**
 * Allocates non-overlapping ports across instances. Combines two checks:
 * known ports already claimed in existing records, and a live `net` bind-probe
 * so it also avoids ports squatted by unrelated processes.
 */
export class PortAllocator {
  /**
   * True if `port` can currently be bound. Binds on `0.0.0.0` (all interfaces)
   * to match how Docker publishes ports — a probe on `127.0.0.1` alone can miss
   * a container bound on `0.0.0.0` under Docker Desktop's VM networking.
   */
  static async isFree(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, '0.0.0.0');
    });
  }

  /**
   * Find the next free port for a role at or after its base, stepping by
   * STRIDE and skipping any port in `taken` or that fails the bind-probe.
   */
  private static async nextFree(
    role: keyof typeof BASES,
    taken: Set<number>,
    preferred?: number
  ): Promise<number> {
    if (preferred !== undefined) {
      if (!taken.has(preferred) && (await this.isFree(preferred))) return preferred;
      throw new Error(`Requested ${role} port ${preferred} is unavailable`);
    }
    for (let i = 0; i < MAX_PROBES; i++) {
      const candidate = BASES[role] + STRIDE * i;
      if (taken.has(candidate)) continue;
      if (await this.isFree(candidate)) return candidate;
    }
    throw new Error(`Could not find a free ${role} port after ${MAX_PROBES} attempts`);
  }

  /**
   * Allocate a full {@link InstancePorts} set. `existing` are ports already
   * claimed by other instances; `reserved` are ports already published by
   * Docker containers (or otherwise off-limits); `requested` lets a YAML config
   * pin specific ports (each is validated for availability).
   */
  static async allocate(
    existing: InstancePorts[],
    requested?: Partial<InstancePorts>,
    reserved: number[] = []
  ): Promise<InstancePorts> {
    const taken = new Set<number>(reserved);
    for (const p of existing) {
      taken.add(p.sql);
      taken.add(p.api);
      taken.add(p.explorer);
    }
    const sql = await this.nextFree('sql', taken, requested?.sql);
    taken.add(sql);
    const api = await this.nextFree('api', taken, requested?.api);
    taken.add(api);
    const explorer = await this.nextFree('explorer', taken, requested?.explorer);
    return { sql, api, explorer };
  }
}
