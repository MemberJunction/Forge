import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  listInstalledNodes,
  resolveNode,
  resolveNodeForWorktree,
  readWorktreeNodeRequirement,
  envWithNode,
} from '../../dist/index.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-node-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readWorktreeNodeRequirement', () => {
  it('parses .nvmrc and engines.node', async () => {
    await fs.writeFile(path.join(dir, '.nvmrc'), '24\n');
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ engines: { node: '>=20.0.0' } })
    );
    const req = readWorktreeNodeRequirement(dir);
    expect(req.nvmrc).toBe('24');
    expect(req.nvmrcMajor).toBe(24);
    expect(req.enginesMajor).toBe(20);
  });

  it('is empty when neither file exists', () => {
    const req = readWorktreeNodeRequirement(dir);
    expect(req.nvmrc).toBeUndefined();
    expect(req.enginesMajor).toBeUndefined();
  });
});

describe('resolveNodeForWorktree', () => {
  it('honors a .nvmrc major that matches an installed version', async () => {
    const installed = listInstalledNodes();
    if (installed.length === 0) return; // no nvm on host — nothing to assert
    const target = installed[0].major; // an installed major
    await fs.writeFile(path.join(dir, '.nvmrc'), `${target}\n`);
    const r = resolveNodeForWorktree(dir, 'auto');
    expect(parseInt((r.version ?? 'v0').replace(/^v/, ''), 10)).toBe(target);
    expect(r.source).toBe('nvmrc');
  });

  it('an explicit spec overrides .nvmrc', async () => {
    const installed = listInstalledNodes();
    if (installed.length < 1) return;
    await fs.writeFile(path.join(dir, '.nvmrc'), '999\n'); // impossible
    const explicit = installed[0].version.replace(/^v/, '');
    const r = resolveNodeForWorktree(dir, explicit);
    expect(r.version).toBe(installed[0].version);
    expect(r.source).toBe('override');
  });

  it('falls back to highest installed when .nvmrc is unsatisfiable', async () => {
    const installed = listInstalledNodes();
    if (installed.length === 0) return;
    await fs.writeFile(path.join(dir, '.nvmrc'), '999\n');
    const r = resolveNodeForWorktree(dir, 'auto');
    expect(r.version).toBe(installed[0].version);
    expect(r.source).toBe('highest');
  });
});

describe('resolveNode (explicit)', () => {
  it('returns empty for an impossible version', () => {
    expect(resolveNode('999').binDir).toBeUndefined();
  });
});

describe('envWithNode', () => {
  it('prepends the bin dir to PATH', () => {
    expect(envWithNode('/opt/node/bin').PATH?.startsWith(`/opt/node/bin${path.delimiter}`)).toBe(
      true
    );
  });
  it('returns a plain env copy when no bin dir', () => {
    expect(envWithNode(undefined).PATH).toBe(process.env.PATH);
  });
});
