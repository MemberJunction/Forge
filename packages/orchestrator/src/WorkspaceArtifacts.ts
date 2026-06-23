/**
 * Editor-navigation artifacts for an instance — the single point of truth for
 * both conveniences that sit beside an instance's `mj/` worktree:
 *
 *  1. **Per-app symlinks** (`<instanceDir>/<app>` → `mj/packages/dev-apps/<app>`):
 *     navigation sugar for the terminal / Finder / non-VS-Code editors. They do
 *     NOT surface the apps' git in VS Code (it dereferences to a realpath inside
 *     `mj/`, below the repo-scan depth) — that's the workspace file's job.
 *  2. **A multi-root `<slug>.code-workspace`**: the file the "Open in VS Code"
 *     button opens. Listing each app's *real* nested path as its own root is the
 *     only thing that gives VS Code per-app Source Control reliably.
 *
 * Both are DERIVED from the dev-linked app set and reconciled idempotently, so
 * there is one point of editing and no drift between the three things that must
 * agree (dev-linked apps, symlinks, workspace roots). The reconciler owns only
 * what it created: it prunes stale symlinks that point into `mj/packages/dev-apps/`,
 * never touches foreign symlinks or real folders, and preserves any keys a user
 * adds to the workspace file (only the `folders` array is managed).
 *
 * Design rationale (why workspace member, why workspace file not symlinks for
 * git) is recorded in `plans/mj-dev-manager-decisions.md`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Relative prefix (from the instance dir) under which dev-linked members nest. */
const devAppsRel = (mjName: string) => `${mjName}/packages/dev-apps/`;

/** Default VS Code workspace settings so nested app repos surface in Source Control. */
const DEFAULT_WORKSPACE_SETTINGS: Record<string, unknown> = {
  'git.repositoryScanMaxDepth': 2,
  'git.openRepositoryInParentFolders': 'always',
};

export interface EditorArtifactResult {
  /** Absolute path to the `.code-workspace` file (whether or not it was written). */
  workspaceFile: string;
  /** True if the workspace file was created or updated this run. */
  workspaceWritten: boolean;
  /** Absolute paths of symlinks that exist after reconciliation. */
  symlinks: string[];
}

/** `instancesRootDir/<slug>/<slug>.code-workspace` (sibling of the `mj/` worktree). */
export function instanceWorkspaceFilePath(worktreePath: string, slug: string): string {
  return path.join(path.dirname(worktreePath), `${slug}.code-workspace`);
}

/**
 * Reconcile the instance's editor artifacts to match `devApps` (the dev-linked
 * app names). Idempotent and conservative — see the module doc.
 */
export function reconcileInstanceEditorArtifacts(
  worktreePath: string,
  slug: string,
  devApps: string[]
): EditorArtifactResult {
  const instanceDir = path.dirname(worktreePath);
  const mjName = path.basename(worktreePath); // normally "mj"
  const workspaceFile = instanceWorkspaceFilePath(worktreePath, slug);

  // Not provisioned yet → nothing to do (best-effort, never throws on missing dir).
  if (!fs.existsSync(instanceDir)) {
    return { workspaceFile, workspaceWritten: false, symlinks: [] };
  }

  const wanted = new Set(devApps);
  const ownedPrefix = devAppsRel(mjName);

  // 1) Prune symlinks WE own (target points into mj/packages/dev-apps/) that are no
  //    longer dev-linked. Foreign symlinks and real folders are left untouched.
  for (const entry of fs.readdirSync(instanceDir)) {
    const full = path.join(instanceDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;
    let target: string;
    try {
      target = fs.readlinkSync(full);
    } catch {
      continue;
    }
    const owned = target.replace(/\\/g, '/').startsWith(ownedPrefix);
    if (owned && !wanted.has(entry)) fs.rmSync(full, { force: true });
  }

  // 2) Ensure a symlink for each dev-linked app (relative target so the layout is
  //    portable). Never overwrite a real (non-symlink) path a user placed there.
  const symlinks: string[] = [];
  for (const app of devApps) {
    const linkPath = path.join(instanceDir, app);
    let existing: fs.Stats | undefined;
    try {
      existing = fs.lstatSync(linkPath);
    } catch {
      existing = undefined;
    }
    if (existing && !existing.isSymbolicLink()) continue; // user data at this name — leave it
    if (existing) fs.rmSync(linkPath, { force: true }); // refresh a stale/old symlink
    fs.symlinkSync(`${ownedPrefix}${app}`, linkPath);
    symlinks.push(linkPath);
  }

  // 3) Workspace file: create on first dev-link, keep updated thereafter, and
  //    preserve any keys the user added (only `folders` is managed). Never created
  //    for a zero-app instance, but an existing one is kept (don't delete user edits).
  let workspaceWritten = false;
  const exists = fs.existsSync(workspaceFile);
  if (exists || devApps.length > 0) {
    let doc: Record<string, unknown> = {};
    if (exists) {
      try {
        doc = JSON.parse(fs.readFileSync(workspaceFile, 'utf-8')) as Record<string, unknown>;
      } catch {
        doc = {};
      }
    }
    doc.folders = [
      { name: 'MJ (instance core)', path: mjName },
      ...devApps.map(app => ({ name: `app: ${app}`, path: `${ownedPrefix}${app}` })),
    ];
    if (!('settings' in doc)) doc.settings = { ...DEFAULT_WORKSPACE_SETTINGS };
    fs.writeFileSync(workspaceFile, `${JSON.stringify(doc, null, 2)}\n`);
    workspaceWritten = true;
  }

  return { workspaceFile, workspaceWritten, symlinks };
}

/**
 * What the "Open in VS Code" action should open: the multi-root workspace if it
 * exists (the per-app-git experience), else the plain worktree dir.
 */
export function resolveEditorTarget(worktreePath: string, slug: string): string {
  const workspaceFile = instanceWorkspaceFilePath(worktreePath, slug);
  return fs.existsSync(workspaceFile) ? workspaceFile : worktreePath;
}
