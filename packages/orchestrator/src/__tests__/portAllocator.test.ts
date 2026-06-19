import { describe, it, expect } from 'vitest';
import * as net from 'node:net';
import { PortAllocator } from '../../dist/index.js';

describe('PortAllocator.allocate', () => {
  it('returns three distinct ports', async () => {
    const p = await PortAllocator.allocate([]);
    const set = new Set([p.sql, p.api, p.explorer]);
    expect(set.size).toBe(3);
  });

  it('avoids ports already claimed by existing instances', async () => {
    const existing = [{ sql: 1433, api: 4000, explorer: 4200 }];
    const p = await PortAllocator.allocate(existing);
    expect(p.sql).not.toBe(1433);
    expect(p.api).not.toBe(4000);
    expect(p.explorer).not.toBe(4200);
  });

  it('throws when a requested port is in use', async () => {
    const server = net.createServer();
    await new Promise<void>(r => server.listen(0, '0.0.0.0', r));
    const busyPort = (server.address() as net.AddressInfo).port;
    try {
      await expect(PortAllocator.allocate([], { sql: busyPort })).rejects.toThrow();
    } finally {
      server.close();
    }
  });
});

describe('PortAllocator.isFree', () => {
  it('reports a bound port as not free', async () => {
    const server = net.createServer();
    await new Promise<void>(r => server.listen(0, '0.0.0.0', r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      expect(await PortAllocator.isFree(port)).toBe(false);
    } finally {
      server.close();
    }
  });
});
