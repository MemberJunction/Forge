import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProcessStore, ProcessManager, resolvePaths } from '../../dist/index.js';
import type { ProcRecord } from '../../dist/index.js';
import type { InstanceRecord } from '@mj-forge/shared';

let dir: string;
let store: ProcessStore;

const rec = (over: Partial<ProcRecord> = {}): ProcRecord => ({
  id: 'p1',
  slug: 'demo',
  label: 'MJAPI',
  script: 'start:api',
  port: 4010,
  pid: 1234,
  pgid: 1234,
  status: 'starting',
  startedAt: '2026-01-01T00:00:00.000Z',
  source: 'cli',
  logFile: '/tmp/x.log',
  targetToken: 'api',
  ...over,
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-proc-'));
  store = new ProcessStore(resolvePaths({ configDir: dir }));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ProcessStore', () => {
  it('returns [] when the registry file does not exist', async () => {
    expect(await store.list()).toEqual([]);
  });

  it('upserts, gets, and filters by slug', async () => {
    await store.upsert(rec({ id: 'a', slug: 'one' }));
    await store.upsert(rec({ id: 'b', slug: 'two' }));
    expect((await store.list()).length).toBe(2);
    expect((await store.list('one')).map(p => p.id)).toEqual(['a']);
    expect((await store.get('b'))?.slug).toBe('two');
  });

  it('upsert replaces an existing row by id (no duplicates)', async () => {
    await store.upsert(rec({ id: 'a', status: 'starting' }));
    await store.upsert(rec({ id: 'a', status: 'running' }));
    const all = await store.list();
    expect(all.length).toBe(1);
    expect(all[0].status).toBe('running');
  });

  it('removes a row', async () => {
    await store.upsert(rec({ id: 'a' }));
    await store.remove('a');
    expect(await store.list()).toEqual([]);
  });

  it('persists atomically (a second store instance reads the same data)', async () => {
    await store.upsert(rec({ id: 'a' }));
    const other = new ProcessStore(resolvePaths({ configDir: dir }));
    expect((await other.list()).map(p => p.id)).toEqual(['a']);
  });

  it('degrades a corrupt registry file to empty instead of throwing', async () => {
    await fs.writeFile(path.join(dir, 'processes.json'), '{ this is not json');
    expect(await store.list()).toEqual([]);
  });
});

describe('ProcessManager.getLogsSince (incremental tail)', () => {
  it('seeks to EOF on negative offset, then streams only new complete lines', async () => {
    const paths = resolvePaths({ configDir: dir });
    const mgr = new ProcessManager(paths);
    const logFile = path.join(dir, 'demo.log');
    await fs.writeFile(logFile, 'old line 1\nold line 2\n');
    await store.upsert(rec({ id: 'p1', logFile }));

    // Negative offset → seek to end, no backlog dump.
    const seek = await mgr.getLogsSince('p1', -1);
    expect(seek.lines).toEqual([]);
    expect(seek.nextByte).toBe((await fs.stat(logFile)).size);

    // Append new content incl. a trailing partial line (no newline yet).
    await fs.appendFile(logFile, 'new line 1\nnew line 2\npartial');
    const read = await mgr.getLogsSince('p1', seek.nextByte);
    expect(read.lines).toEqual(['new line 1', 'new line 2']); // partial held back

    // Reading again from the new offset yields nothing until the line completes.
    const idle = await mgr.getLogsSince('p1', read.nextByte);
    expect(idle.lines).toEqual([]);

    // Completing the partial line surfaces it next read.
    await fs.appendFile(logFile, '-done\n');
    const finish = await mgr.getLogsSince('p1', read.nextByte);
    expect(finish.lines).toEqual(['partial-done']);
  });

  it('restarts from 0 when the offset is past EOF (rotated/truncated)', async () => {
    const mgr = new ProcessManager(resolvePaths({ configDir: dir }));
    const logFile = path.join(dir, 'rot.log');
    await fs.writeFile(logFile, 'a\nb\n');
    await store.upsert(rec({ id: 'p2', logFile }));
    const read = await mgr.getLogsSince('p2', 9999);
    expect(read.lines).toEqual(['a', 'b']);
  });
});

describe('ProcessManager.listRunTargets', () => {
  it('lists api + explorer services plus package scripts (excluding the service scripts)', async () => {
    const wt = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-wt-'));
    await fs.writeFile(
      path.join(wt, 'package.json'),
      JSON.stringify({
        scripts: { 'start:api': 'x', start: 'x', 'dev:watch': 'x', build: 'x' },
      })
    );
    const record = {
      slug: 'demo',
      worktreePath: wt,
      ports: { sql: 1433, api: 4010, explorer: 4210 },
    } as unknown as InstanceRecord;

    const opts = await ProcessManager.listRunTargets(record);
    const byName = Object.fromEntries(opts.map(o => [o.name, o]));

    expect(byName.api).toMatchObject({ kind: 'service', port: 4010 });
    expect(byName.explorer).toMatchObject({ kind: 'service', port: 4210 });
    // discovered script kept...
    expect(byName['dev:watch']).toMatchObject({ kind: 'script' });
    // ...but the service-backing scripts are not offered twice, and 'build'
    // doesn't match the start|serve|dev|watch filter.
    expect(byName['start:api']).toBeUndefined();
    expect(byName.start).toBeUndefined();
    expect(byName.build).toBeUndefined();

    await fs.rm(wt, { recursive: true, force: true });
  });
});
