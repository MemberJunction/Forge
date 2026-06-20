import * as net from 'node:net';
import type { InstancePorts } from '@mj-forge/shared';

/**
 * Base port for each role; instance N gets base + STRIDE * N. Explorer starts
 * at 4300 — clear of Forge's own dev renderer (`ng serve` on 4200) and a vanilla
 * MJExplorer (4201), so the first instance never collides with the running app.
 */
const BASES = { sql: 1433, api: 4000, explorer: 4300 } as const;
const STRIDE = 10;
const MAX_PROBES = 200;

/**
 * Allocates non-overlapping ports across instances. Combines two checks:
 * known ports already claimed in existing records, and a live `net` bind-probe
 * so it also avoids ports squatted by unrelated processes.
 */
export class PortAllocator {
  /**
   * True only if `port` is free on BOTH IP stacks. We probe the IPv4 wildcard
   * (`0.0.0.0`) to catch Docker-published ports (Docker Desktop's VM networking
   * binds there, which a `127.0.0.1` probe misses) AND the IPv6 loopback
   * (`::1`) to catch dev servers like Angular's `ng serve`, which bind
   * `localhost` → `[::1]` on macOS. Probing only IPv4 falsely reports an
   * IPv6-only listener's port as free; the two stacks are independent. We probe
   * the *specific* `::1` rather than the `::` wildcard because Node sets
   * `SO_REUSEADDR`, under which a fresh wildcard bind coexists with an existing
   * specific-address listener and would miss it.
   */
  static async isFree(port: number): Promise<boolean> {
    return (await this.canBind(port, '0.0.0.0')) && (await this.canBind(port, '::1'));
  }

  /** True if a server can bind `port` on the given host. */
  private static canBind(port: number, host: string): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(port, host);
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
