import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Resolves which Node version an instance's setup/build/serve commands run
 * under — independent of the Forge app's own Node. This lets an MJ checkout
 * that wants Node 24 (its `.nvmrc`) build even when Forge itself is pinned to
 * Node 20 for Electron.
 *
 * Default (`'auto'`) honors the *repository's own declaration*: the worktree's
 * `.nvmrc`, bumped up if `package.json`'s `engines.node` requires higher. The
 * user only sets an explicit version to troubleshoot. Versions are discovered
 * from nvm (`~/.nvm/versions/node/v*`); the chosen version's `bin` is prepended
 * to the child PATH so `node`, `npm`, and `node-gyp` all resolve to it.
 */
export interface InstalledNode {
  version: string; // e.g. "v24.16.0"
  major: number;
  binDir: string;
}

/** All nvm-installed Node versions, newest first. */
export function listInstalledNodes(): InstalledNode[] {
  const base = path.join(os.homedir(), '.nvm', 'versions', 'node');
  let entries: string[];
  try {
    entries = fs.readdirSync(base);
  } catch {
    return [];
  }
  return entries
    .filter(v => /^v\d+\./.test(v))
    .map(v => ({ version: v, major: parseInt(v.slice(1), 10), binDir: path.join(base, v, 'bin') }))
    .filter(n => fs.existsSync(path.join(n.binDir, 'node')))
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

export interface ResolvedNode {
  binDir?: string;
  version?: string;
  /** Where the choice came from, for surfacing in the UI/logs. */
  source?: 'override' | 'nvmrc' | 'engines' | 'highest' | 'inherit';
}

/** What the repo declares it wants. */
export interface NodeRequirement {
  nvmrc?: string;
  nvmrcMajor?: number;
  enginesMajor?: number;
}

/** Read a worktree's `.nvmrc` and root `engines.node` floor. */
export function readWorktreeNodeRequirement(worktreePath: string): NodeRequirement {
  const req: NodeRequirement = {};
  try {
    const raw = fs.readFileSync(path.join(worktreePath, '.nvmrc'), 'utf8').trim();
    if (raw) {
      req.nvmrc = raw;
      const m = raw.replace(/^v/, '').match(/^(\d+)/);
      if (m) req.nvmrcMajor = parseInt(m[1], 10);
    }
  } catch {
    /* no .nvmrc */
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(worktreePath, 'package.json'), 'utf8'));
    const e: unknown = pkg?.engines?.node;
    if (typeof e === 'string') {
      const m = e.match(/(\d+)/);
      if (m) req.enginesMajor = parseInt(m[1], 10);
    }
  } catch {
    /* no/invalid package.json */
  }
  return req;
}

/**
 * Resolve an explicit version spec to an installed Node.
 * - `"24"` / `"v24"` → highest installed v24.x
 * - `"24.16.0"` → exact match
 * Returns `{}` when nothing matches.
 */
export function resolveNode(spec: string): ResolvedNode {
  const installed = listInstalledNodes();
  if (installed.length === 0) return {};
  const cleaned = spec.replace(/^v/, '');
  const exact = installed.find(n => n.version === `v${cleaned}`);
  if (exact) return { binDir: exact.binDir, version: exact.version, source: 'override' };
  const major = parseInt(cleaned, 10);
  const byMajor = installed.find(n => n.major === major);
  if (byMajor) return { binDir: byMajor.binDir, version: byMajor.version, source: 'override' };
  return {};
}

/**
 * Resolve the Node version for an instance.
 * - explicit `spec` (not `'auto'`/empty) → that version (troubleshooting override)
 * - otherwise → honor the worktree's `.nvmrc`, bumped to satisfy `engines.node`,
 *   matched against installed nvm versions; falls back to the highest installed.
 * Returns `{}` (inherit the host Node) only when no nvm Node is installed.
 */
export function resolveNodeForWorktree(worktreePath: string, spec?: string): ResolvedNode {
  if (spec && spec !== 'auto') return resolveNode(spec);

  const installed = listInstalledNodes();
  if (installed.length === 0) return {};

  const req = readWorktreeNodeRequirement(worktreePath);
  const floor = Math.max(req.nvmrcMajor ?? 0, req.enginesMajor ?? 0);

  // 1) Exact full version from .nvmrc (e.g. "24.16.0").
  if (req.nvmrc && /^\d+\.\d+\.\d+$/.test(req.nvmrc.replace(/^v/, ''))) {
    const exact = installed.find(n => n.version === `v${req.nvmrc!.replace(/^v/, '')}`);
    if (exact) return { binDir: exact.binDir, version: exact.version, source: 'nvmrc' };
  }
  // 2) Honor the .nvmrc major (highest installed of that major) — the repo's intent.
  if (req.nvmrcMajor !== undefined) {
    const sameMajor = installed.find(n => n.major === req.nvmrcMajor);
    if (sameMajor) return { binDir: sameMajor.binDir, version: sameMajor.version, source: 'nvmrc' };
  }
  // 3) Nothing matched the declared version, but a floor exists — satisfy it.
  if (floor > 0) {
    const satisfying = installed.find(n => n.major >= floor);
    if (satisfying) {
      const source =
        req.enginesMajor && req.enginesMajor >= (req.nvmrcMajor ?? 0) ? 'engines' : 'nvmrc';
      return { binDir: satisfying.binDir, version: satisfying.version, source };
    }
  }
  // 4) Best effort: highest installed.
  return { binDir: installed[0].binDir, version: installed[0].version, source: 'highest' };
}

/** A child-process env with `binDir` prepended to PATH (or a copy of process.env). */
export function envWithNode(binDir?: string): NodeJS.ProcessEnv {
  if (!binDir) return { ...process.env };
  return { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` };
}
