import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AppDevStateStore, resolvePaths } from '../../dist/index.js';
import type { AppDevState } from '../../dist/index.js';

function makeState(slug: string, appName: string, mode: 'dev' | 'installed' = 'dev'): AppDevState {
  return {
    slug,
    appName,
    appRef: `https://github.com/MemberJunction/${appName}`,
    mode,
    localDevPath: `/ws/repos/apps/${appName}`,
    materialization: 'symlink',
    ignoreVersionRangeUsed: false,
    createdAt: '2026-06-21T00:00:00.000Z',
  };
}

let dir: string;
let store: AppDevStateStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-openapps-'));
  store = new AppDevStateStore(resolvePaths({ configDir: dir }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('AppDevStateStore', () => {
  it('returns empty before anything is written', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.get('a', 'x')).toBeUndefined();
  });

  it('upserts, gets, filters by slug, and removes', async () => {
    await store.upsert(makeState('inst1', 'bizapps-accounting'));
    await store.upsert(makeState('inst1', 'mj-sample-open-app'));
    await store.upsert(makeState('inst2', 'bizapps-accounting'));

    expect((await store.list()).length).toBe(3);
    expect((await store.list('inst1')).map(a => a.appName).sort()).toEqual([
      'bizapps-accounting',
      'mj-sample-open-app',
    ]);
    expect((await store.get('inst2', 'bizapps-accounting'))?.slug).toBe('inst2');

    // Upsert replaces in place (matched by slug+appName).
    await store.upsert(makeState('inst1', 'bizapps-accounting', 'installed'));
    expect((await store.get('inst1', 'bizapps-accounting'))?.mode).toBe('installed');
    expect((await store.list()).length).toBe(3);

    await store.remove('inst1', 'mj-sample-open-app');
    expect((await store.list('inst1')).length).toBe(1);
  });

  it('drops all state for an instance', async () => {
    await store.upsert(makeState('inst1', 'a'));
    await store.upsert(makeState('inst1', 'b'));
    await store.upsert(makeState('inst2', 'a'));
    await store.removeForInstance('inst1');
    expect(await store.list('inst1')).toEqual([]);
    expect((await store.list('inst2')).length).toBe(1);
  });

  it('persists across store instances and self-heals a corrupt file', async () => {
    await store.upsert(makeState('inst1', 'a'));
    const other = new AppDevStateStore(resolvePaths({ configDir: dir }));
    expect((await other.list()).length).toBe(1);

    await fs.writeFile(path.join(dir, 'openapps.json'), '{ this is not json');
    expect(await other.list()).toEqual([]); // degrades to empty instead of throwing
  });
});
