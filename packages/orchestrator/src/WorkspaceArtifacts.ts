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

  // Ensure the per-instance agent work logs (TASKS/BACKLOG/BUGS) exist — never clobber.
  ensureInstanceWorkLogs(worktreePath, slug);

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

/**
 * Ensure the per-instance agent work logs exist at the instance root (sibling of `mj/`):
 *   - `TASKS.md`   — what agents are actively doing in this instance
 *   - `BACKLOG.md` — wanted-but-not-started work for this instance
 *   - `BUGS.md`    — bugs found in the code being developed here
 * Create-if-absent, **NEVER clobbered** (they accumulate agent-authored content, like
 * `MJDEV-ISSUES.md`). Returns the basenames created this call.
 */
export function ensureInstanceWorkLogs(worktreePath: string, slug: string): string[] {
  const instanceDir = path.dirname(worktreePath);
  if (!fs.existsSync(instanceDir)) return [];
  const files: Array<[string, string]> = [
    ['TASKS.md', tasksSeed(slug)],
    ['BACKLOG.md', backlogSeed(slug)],
    ['BUGS.md', bugsSeed(slug)],
  ];
  const created: string[] = [];
  for (const [name, seed] of files) {
    const p = path.join(instanceDir, name);
    if (!fs.existsSync(p)) {
      try {
        fs.writeFileSync(p, seed, 'utf8');
        created.push(name);
      } catch {
        /* best-effort — work logs must never block a lifecycle op */
      }
    }
  }
  return created;
}

/** Shared entry-convention note for the per-instance logs (matches chat/ORCHESTRATION). */
const WORKLOG_CONVENTION = [
  'Use the same task convention as chat (see `.mjdev-docs/ORCHESTRATION.md` → "Reporting back"):',
  'a `<batch><letter>` id + a short name, plus the branch + this instance. Reference a task by',
  'BOTH its id and short name, e.g. "Task 2c (MJExplorer debugging)".',
].join('\n');

function tasksSeed(slug: string): string {
  return [
    `# Tasks — ${slug}`,
    '',
    'Live log of what agents are **actively doing in this instance**. Add a task when you start it,',
    'update its status as it moves, mark DONE when finished. Keep it current — this is how the user',
    '(and other agents) see what is in flight here.',
    '',
    WORKLOG_CONVENTION,
    '',
    '## Entry template',
    '```',
    '### Task <batch><letter> · <short name>',
    '- Status: TODO | IN-PROGRESS | DONE',
    '- Branch · instance: <branch> · ' + slug,
    '- Target: <files / sections you plan to change>',
    '- Goal: <what success looks like>',
    '- Plan: <what you are going to do>',
    '```',
    '',
    '---',
    '',
  ].join('\n');
}

function backlogSeed(slug: string): string {
  return [
    `# Backlog — ${slug}`,
    '',
    'Wanted work for this instance that is **not started yet**. Promote an item to `TASKS.md` when',
    'you pick it up. Same format as tasks.',
    '',
    WORKLOG_CONVENTION,
    '',
    '## Entry template',
    '```',
    '### Task <batch><letter> · <short name>',
    '- Status: BACKLOG',
    '- Branch · instance: <branch> · ' + slug,
    '- Target: <files / sections likely to change>',
    '- Goal: <what success looks like>',
    '- Plan: <rough approach>',
    '```',
    '',
    '---',
    '',
  ].join('\n');
}

function bugsSeed(slug: string): string {
  return [
    `# Bugs — ${slug}`,
    '',
    'Bugs/issues found while developing **in this instance** (in the MJ / open-app code you are',
    'working on here). A suspected **mjdev-tool** bug goes to `~/MJDev/MJDEV-ISSUES.md` instead —',
    'this file is for the code under development in this instance.',
    '',
    WORKLOG_CONVENTION,
    '',
    '## Entry template',
    '```',
    '### Bug <batch><letter> · <short name>',
    '- Status: OPEN | FIXED | WONTFIX',
    '- Found: <date> by <agent> · branch <branch> · instance ' + slug,
    '- Repro: <exact steps>',
    '- Expected vs actual:',
    '- Fix / notes:',
    '```',
    '',
    '---',
    '',
  ].join('\n');
}
