import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { syncAgentDocs, upsertManagedRegion, resolvePaths } from '../../dist/index.js';

let tmp: string;
let docsSrc: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mjdev-docs-'));
  docsSrc = path.join(tmp, 'src-docs');
  await fs.mkdir(docsSrc, { recursive: true });
  await fs.writeFile(path.join(docsSrc, 'ORCHESTRATION.md'), '# Orchestration\n', 'utf8');
  await fs.writeFile(path.join(docsSrc, 'SAFETY.md'), '# Safety\n', 'utf8');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

function devPaths() {
  return resolvePaths({
    workspaceRoot: path.join(tmp, 'MJDev-dev'),
    configDir: path.join(tmp, '.mjdev-dev'),
    containerPrefix: 'mjdev-dev',
  });
}

const read = (p: string) => fs.readFile(p, 'utf8');
const exists = async (p: string) => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

describe('syncAgentDocs', () => {
  it('publishes docs, snapshot, AGENTS, CLAUDE, issues, and an executable launcher', async () => {
    const paths = devPaths();
    const cliEntry = '/abs/packages/cli/dist/mjdev.js';
    const res = await syncAgentDocs(paths, {
      docsSourceDir: docsSrc,
      cliEntry,
      instances: [{ slug: 'demo', branch: 'mjdev/demo', status: 'running' }],
      now: '2026-06-23T00:00:00.000Z',
    });

    // Docs copied verbatim into .mjdev-docs
    expect(res.copied.sort()).toEqual(['ORCHESTRATION.md', 'SAFETY.md']);
    expect(await exists(path.join(res.docsDir, 'ORCHESTRATION.md'))).toBe(true);

    // Live snapshot regenerated with the roster + the isolated prefix
    const snap = await read(path.join(res.docsDir, 'WORKSPACE-SNAPSHOT.md'));
    expect(snap).toContain('demo');
    expect(snap).toContain('mjdev-dev');
    expect(snap).toContain('2026-06-23T00:00:00.000Z');

    // AGENTS.md carries the managed block; CLAUDE.md imports it; issues seeded
    expect(await read(res.agentsFile)).toContain('<!-- BEGIN MJDEV-MANAGED -->');
    expect(res.claudeCreated).toBe(true);
    expect(await read(path.join(paths.workspaceRoot, 'CLAUDE.md'))).toContain('@AGENTS.md');
    expect(res.issuesCreated).toBe(true);
    expect(await read(path.join(paths.workspaceRoot, 'MJDEV-ISSUES.md'))).toContain('NOT-MJDEV');

    // Launcher: 0755, pins the isolation env, points at the CLI entry
    const launcher = await read(res.launcher);
    expect(launcher.startsWith('#!/bin/sh')).toBe(true);
    expect(launcher).toContain(`MJDEV_WORKSPACE_DIR="${paths.workspaceRoot}"`);
    expect(launcher).toContain('MJDEV_CONTAINER_PREFIX="mjdev-dev"');
    expect(launcher).toContain(cliEntry);
    const mode = (await fs.stat(res.launcher)).mode & 0o777;
    expect(mode & 0o111).toBeTruthy(); // executable bit set

    // Hands-off-except-destructive permission settings
    expect(res.settingsCreated).toBe(true);
    const settings = JSON.parse(
      await read(path.join(paths.workspaceRoot, '.claude', 'settings.json'))
    );
    expect(settings.permissions.deny).toContain('Bash(git push:*)');
    expect(settings.permissions.deny.some((d: string) => d.includes(paths.configDir))).toBe(true);
    expect(settings.permissions.ask).toContain('Bash(./bin/mjdev delete:*)');
  });

  it('is idempotent: a second run keeps exactly one managed block', async () => {
    const paths = devPaths();
    await syncAgentDocs(paths, { docsSourceDir: docsSrc });
    await syncAgentDocs(paths, { docsSourceDir: docsSrc });
    const agents = await read(paths.workspaceRoot + '/AGENTS.md');
    expect(agents.match(/BEGIN MJDEV-MANAGED/g)?.length).toBe(1);
    expect(agents.match(/END MJDEV-MANAGED/g)?.length).toBe(1);
  });

  it("preserves the user's own AGENTS.md prose outside the managed region", async () => {
    const paths = devPaths();
    await fs.mkdir(paths.workspaceRoot, { recursive: true });
    await fs.writeFile(
      path.join(paths.workspaceRoot, 'AGENTS.md'),
      '# My team notes\nKeep this.\n',
      'utf8'
    );
    await syncAgentDocs(paths, { docsSourceDir: docsSrc });
    const agents = await read(path.join(paths.workspaceRoot, 'AGENTS.md'));
    expect(agents).toContain('My team notes');
    expect(agents).toContain('Keep this.');
    expect(agents).toContain('<!-- BEGIN MJDEV-MANAGED -->');
  });

  it('never clobbers an existing CLAUDE.md or MJDEV-ISSUES.md', async () => {
    const paths = devPaths();
    await fs.mkdir(paths.workspaceRoot, { recursive: true });
    await fs.writeFile(path.join(paths.workspaceRoot, 'CLAUDE.md'), 'custom claude\n', 'utf8');
    await fs.writeFile(
      path.join(paths.workspaceRoot, 'MJDEV-ISSUES.md'),
      '### existing issue\nkeep me\n',
      'utf8'
    );
    await fs.mkdir(path.join(paths.workspaceRoot, '.claude'), { recursive: true });
    await fs.writeFile(
      path.join(paths.workspaceRoot, '.claude', 'settings.json'),
      '{"my":"perms"}\n',
      'utf8'
    );
    const res = await syncAgentDocs(paths, { docsSourceDir: docsSrc });
    expect(res.claudeCreated).toBe(false);
    expect(res.issuesCreated).toBe(false);
    expect(res.settingsCreated).toBe(false);
    expect(await read(path.join(paths.workspaceRoot, 'CLAUDE.md'))).toBe('custom claude\n');
    expect(await read(path.join(paths.workspaceRoot, 'MJDEV-ISSUES.md'))).toContain('keep me');
    expect(await read(path.join(paths.workspaceRoot, '.claude', 'settings.json'))).toBe(
      '{"my":"perms"}\n'
    );
  });
});

describe('upsertManagedRegion', () => {
  it('creates a block from nothing', () => {
    const out = upsertManagedRegion(null, 'hello');
    expect(out).toBe('<!-- BEGIN MJDEV-MANAGED -->\nhello\n<!-- END MJDEV-MANAGED -->\n');
  });
  it('replaces an existing block in place, leaving surrounding prose', () => {
    const start = 'top\n<!-- BEGIN MJDEV-MANAGED -->\nold\n<!-- END MJDEV-MANAGED -->\nbottom\n';
    const out = upsertManagedRegion(start, 'new');
    expect(out).toContain('top');
    expect(out).toContain('bottom');
    expect(out).toContain('new');
    expect(out).not.toContain('old');
    expect(out.match(/BEGIN MJDEV-MANAGED/g)?.length).toBe(1);
  });
  it('appends a block when prose has none', () => {
    const out = upsertManagedRegion('just prose\n', 'managed');
    expect(out.startsWith('just prose')).toBe(true);
    expect(out).toContain('<!-- BEGIN MJDEV-MANAGED -->');
  });
});
