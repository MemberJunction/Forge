import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { PersonaStore, resolvePaths } from '../../dist/index.js';

let dir: string;
let store: PersonaStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-personas-'));
  store = new PersonaStore(resolvePaths({ configDir: dir }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('PersonaStore', () => {
  it('returns an empty roster before anything is written', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.getActive()).toBeUndefined();
  });

  it('assigns an id on save and makes the first persona active', async () => {
    const saved = await store.save({ name: 'Admin', email: 'admin@mjdev.local', roles: ['Owner'] });
    expect(saved.id).toBeTruthy();
    expect((await store.getActive())?.id).toBe(saved.id);
  });

  it('updates an existing persona in place (matched by id)', async () => {
    const a = await store.save({ name: 'Admin', email: 'admin@mjdev.local', roles: [] });
    await store.save({ id: a.id, name: 'Admin 2', email: 'admin@mjdev.local', roles: ['UI'] });
    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Admin 2');
    expect(all[0].roles).toEqual(['UI']);
  });

  it('keeps the active pointer when adding more personas', async () => {
    const first = await store.save({ name: 'Admin', email: 'a@mjdev.local', roles: [] });
    await store.save({ name: 'Viewer', email: 'v@mjdev.local', roles: [] });
    expect((await store.getActive())?.id).toBe(first.id);
  });

  it('switches the active persona only to a known id', async () => {
    await store.save({ name: 'Admin', email: 'a@mjdev.local', roles: [] });
    const viewer = await store.save({ name: 'Viewer', email: 'v@mjdev.local', roles: [] });
    await store.setActive(viewer.id);
    expect((await store.getActive())?.id).toBe(viewer.id);
    await expect(store.setActive('nope')).rejects.toThrow(/No persona/);
  });

  it('reassigns active to a survivor when the active persona is removed', async () => {
    const admin = await store.save({ name: 'Admin', email: 'a@mjdev.local', roles: [] });
    const viewer = await store.save({ name: 'Viewer', email: 'v@mjdev.local', roles: [] });
    await store.remove(admin.id);
    expect((await store.getActive())?.id).toBe(viewer.id);
    await store.remove(viewer.id);
    expect(await store.getActive()).toBeUndefined();
  });

  it('persists to personas.json so the CLI and GUI share it', async () => {
    await store.save({ name: 'Admin', email: 'a@mjdev.local', roles: [] });
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'personas.json'), 'utf8'));
    expect(onDisk.personas).toHaveLength(1);
    expect(onDisk.activePersonaId).toBeTruthy();
  });
});
