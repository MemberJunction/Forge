/**
 * Editor-navigation artifacts reconciler.
 *
 * One derived, idempotent function owns BOTH per-instance conveniences:
 *  - sibling symlinks next to `mj/` (terminal/Finder navigation), and
 *  - the multi-root `<slug>.code-workspace` (the file the "Open in VS Code"
 *    button opens — the only path that surfaces per-app Source Control).
 * Both are derived from the dev-linked app set, so there's a single point of
 * editing and no drift. It must preserve user edits to the workspace file and
 * never destroy artifacts it doesn't own.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  reconcileInstanceEditorArtifacts,
  resolveEditorTarget,
  instanceWorkspaceFilePath,
  ensureInstanceWorkLogs,
} from '../WorkspaceArtifacts';

const WORK_LOGS = ['BACKLOG.md', 'BUGS.md', 'TASKS.md'];

const slug = 'demo';
let root: string;
let worktreePath: string;

const instanceDir = () => path.dirname(worktreePath);
const readWs = () =>
  JSON.parse(fs.readFileSync(instanceWorkspaceFilePath(worktreePath, slug), 'utf-8'));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mjdev-ws-'));
  worktreePath = path.join(root, 'instances', slug, 'mj');
  // Materialize the nested members the symlinks/workspace roots point at.
  for (const a of ['app-a', 'app-b']) {
    fs.mkdirSync(path.join(worktreePath, 'packages', 'dev-apps', a), { recursive: true });
  }
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('reconcileInstanceEditorArtifacts', () => {
  it('no dev apps + no prior workspace → no workspace file, no symlinks (but work logs seeded)', () => {
    const r = reconcileInstanceEditorArtifacts(worktreePath, slug, []);
    expect(r.workspaceWritten).toBe(false);
    expect(fs.existsSync(r.workspaceFile)).toBe(false);
    // instanceDir now also carries the per-instance work logs (TASKS/BACKLOG/BUGS).
    expect(fs.readdirSync(instanceDir()).sort()).toEqual([...WORK_LOGS, 'mj'].sort());
  });

  it('dev apps → symlinks resolving to the members + a multi-root workspace at real paths', () => {
    reconcileInstanceEditorArtifacts(worktreePath, slug, ['app-a', 'app-b']);
    for (const a of ['app-a', 'app-b']) {
      const link = path.join(instanceDir(), a);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(link)).toBe(`mj/packages/dev-apps/${a}`);
      expect(fs.existsSync(link)).toBe(true); // resolves to the real member dir
    }
    const ws = readWs();
    // Workspace points at the REAL nested paths (not the symlinks) to avoid double-listing.
    expect(ws.folders).toEqual([
      { name: 'MJ (instance core)', path: 'mj' },
      { name: 'app: app-a', path: 'mj/packages/dev-apps/app-a' },
      { name: 'app: app-b', path: 'mj/packages/dev-apps/app-b' },
    ]);
    expect(ws.settings['git.repositoryScanMaxDepth']).toBe(2);
  });

  it('unlinking one app prunes its symlink + workspace root, preserving user settings', () => {
    reconcileInstanceEditorArtifacts(worktreePath, slug, ['app-a', 'app-b']);
    // The user customizes the workspace file by hand.
    const doc = readWs();
    doc.settings['editor.tabSize'] = 2;
    doc.extensions = { recommendations: ['dbaeumer.vscode-eslint'] };
    fs.writeFileSync(instanceWorkspaceFilePath(worktreePath, slug), JSON.stringify(doc, null, 2));

    reconcileInstanceEditorArtifacts(worktreePath, slug, ['app-a']); // drop app-b

    expect(fs.existsSync(path.join(instanceDir(), 'app-b'))).toBe(false); // symlink pruned
    expect(fs.lstatSync(path.join(instanceDir(), 'app-a')).isSymbolicLink()).toBe(true);
    const ws = readWs();
    expect(ws.folders.map((f: { path: string }) => f.path)).toEqual([
      'mj',
      'mj/packages/dev-apps/app-a',
    ]);
    expect(ws.settings['editor.tabSize']).toBe(2); // user setting survives
    expect(ws.extensions.recommendations).toContain('dbaeumer.vscode-eslint'); // user key survives
  });

  it('is idempotent — a second run produces an identical workspace + symlinks', () => {
    reconcileInstanceEditorArtifacts(worktreePath, slug, ['app-a']);
    const first = fs.readFileSync(instanceWorkspaceFilePath(worktreePath, slug), 'utf-8');
    reconcileInstanceEditorArtifacts(worktreePath, slug, ['app-a']);
    const second = fs.readFileSync(instanceWorkspaceFilePath(worktreePath, slug), 'utf-8');
    expect(second).toBe(first);
    expect(fs.lstatSync(path.join(instanceDir(), 'app-a')).isSymbolicLink()).toBe(true);
  });

  it('never destroys a user-owned symlink or real folder it does not manage', () => {
    fs.symlinkSync('../elsewhere', path.join(instanceDir(), 'notes')); // user symlink, foreign target
    fs.mkdirSync(path.join(instanceDir(), 'scratch')); // user real folder
    reconcileInstanceEditorArtifacts(worktreePath, slug, ['app-a']);
    expect(fs.lstatSync(path.join(instanceDir(), 'notes')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(instanceDir(), 'scratch'))).toBe(true);
  });

  it('no-ops safely when the instance dir does not exist yet', () => {
    const missing = path.join(root, 'instances', 'ghost', 'mj');
    const r = reconcileInstanceEditorArtifacts(missing, 'ghost', ['app-a']);
    expect(r.workspaceWritten).toBe(false);
    expect(r.symlinks).toEqual([]);
  });
});

describe('resolveEditorTarget', () => {
  it('returns the worktree dir when there is no workspace file', () => {
    expect(resolveEditorTarget(worktreePath, slug)).toBe(worktreePath);
  });
  it('returns the .code-workspace once it exists', () => {
    reconcileInstanceEditorArtifacts(worktreePath, slug, ['app-a']);
    expect(resolveEditorTarget(worktreePath, slug)).toBe(
      instanceWorkspaceFilePath(worktreePath, slug)
    );
  });
});

describe('ensureInstanceWorkLogs', () => {
  it('creates TASKS/BACKLOG/BUGS at the instance root with the right shape', () => {
    const created = ensureInstanceWorkLogs(worktreePath, slug);
    expect(created.sort()).toEqual([...WORK_LOGS].sort());
    expect(fs.readFileSync(path.join(instanceDir(), 'TASKS.md'), 'utf-8')).toContain(
      'Target: <files'
    );
    expect(fs.readFileSync(path.join(instanceDir(), 'BUGS.md'), 'utf-8')).toContain(
      'OPEN | FIXED | WONTFIX'
    );
    expect(fs.readFileSync(path.join(instanceDir(), 'BACKLOG.md'), 'utf-8')).toContain('BACKLOG');
  });

  it('never clobbers existing work logs', () => {
    fs.writeFileSync(path.join(instanceDir(), 'TASKS.md'), '# keep me\n', 'utf-8');
    const created = ensureInstanceWorkLogs(worktreePath, slug);
    expect(created.sort()).toEqual(['BACKLOG.md', 'BUGS.md']); // TASKS.md untouched
    expect(fs.readFileSync(path.join(instanceDir(), 'TASKS.md'), 'utf-8')).toContain('keep me');
  });
});
