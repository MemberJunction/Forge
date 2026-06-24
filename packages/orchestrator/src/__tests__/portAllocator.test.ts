import { describe, it, expect } from 'vitest';
import * as net from 'node:net';
import { PortAllocator } from '../../dist/index.js';

describe('PortAllocator.allocate', () => {
  // SQL is now fixed to the shared server's port (passed in); only api/explorer
  // are striped per instance.
  it('pins sql to the shared server port and returns three distinct ports', async () => {
    const p = await PortAllocator.allocate([], undefined, [], 1500);
    expect(p.sql).toBe(1500);
    const set = new Set([p.sql, p.api, p.explorer]);
    expect(set.size).toBe(3);
  });

  it('avoids api/explorer ports already claimed by existing instances', async () => {
    const existing = [{ sql: 1500, api: 4000, explorer: 4300 }];
    const p = await PortAllocator.allocate(existing, undefined, [], 1500);
    expect(p.api).not.toBe(4000);
    expect(p.explorer).not.toBe(4300);
  });

  it('throws when a requested api/explorer port is in use', async () => {
    const server = net.createServer();
    await new Promise<void>(r => server.listen(0, '0.0.0.0', r));
    const busyPort = (server.address() as net.AddressInfo).port;
    try {
      await expect(PortAllocator.allocate([], { api: busyPort }, [], 1500)).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});

describe('PortAllocator.allocateServerPort', () => {
  it('returns a free port at or above 1433 by default', async () => {
    const port = await PortAllocator.allocateServerPort([]);
    expect(port).toBeGreaterThanOrEqual(1433);
    expect(await PortAllocator.isFree(port)).toBe(true);
  });

  it('skips a reserved port (e.g. the other workspace server) and lands higher', async () => {
    // Simulate prod publishing 1433 → dev must not pick it.
    const port = await PortAllocator.allocateServerPort([1433]);
    expect(port).not.toBe(1433);
    expect(port).toBeGreaterThanOrEqual(1434);
  });
});

describe('PortAllocator.isFree', () => {
  it('reports a port bound on IPv4 as not free', async () => {
    const server = net.createServer();
    await new Promise<void>(r => server.listen(0, '0.0.0.0', r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await PortAllocator.isFree(port)).toBe(false);
    } finally {
      server.close();
    }
  });

  // Regression: Angular's `ng serve` (and Forge's own dev renderer) bind
  // localhost → [::1] on macOS. A probe that only tried IPv4 reported these
  // ports as free and handed an instance a port the GUI was already serving on.
  it('reports a port bound only on IPv6 localhost as not free', async () => {
    const server = net.createServer();
    await new Promise<void>(r => server.listen(0, '::1', r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await PortAllocator.isFree(port)).toBe(false);
    } finally {
      server.close();
    }
  });
});
