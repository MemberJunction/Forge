import * as fs from 'node:fs/promises';
import type { ResolvedPaths } from './paths.js';

/** Whether an open app resolves from local source or a published release. */
export type OpenAppMode = 'dev' | 'installed';

/**
 * A reversible edit made to a worktree file during dev-link (e.g. neutralizing an
 * app sub-package's `@memberjunction/*` pin to `"*"` so it dedupes to the host
 * copy). Captured so a mode switch / unlink can restore the original bytes.
 */
export interface ReversibleFileEdit {
  /** Absolute path of the edited file. */
  file: string;
  /** Map of JSON-ish key → original string value, restored verbatim on reversal. */
  original: Record<string, string>;
}

/**
 * Forge-side, dev-only state for one open app linked into one instance. The
 * authoritative install record still lives MJ-side in `MJ: Open Apps`; this
 * overlay only tracks what Forge needs to reverse a link cleanly (the resolution
 * seam, the reversible transforms, the captured original deps).
 */
export interface AppDevState {
  /** Instance slug the app is linked into. */
  slug: string;
  /** App identity (manifest name, falls back to the clone dir name). */
  appName: string;
  /** GitHub URL or local path the app was linked from. */
  appRef: string;
  mode: OpenAppMode;
  /** Canonical editable clone path (`~/MJDev/repos/apps/<app>`). */
  localDevPath: string;
  /** How the app is materialized as a workspace member (Option Y nests a worktree). */
  materialization: 'nested-worktree' | 'symlink' | 'copy';
  /** True when the MJ version-range check was overridden for this link. */
  ignoreVersionRangeUsed: boolean;
  /** Branch checked out in the canonical clone, if pinned. */
  linkedBranch?: string;
  /** Reversible `@memberjunction/*` pin neutralizations applied to app sub-packages. */
  pinTransforms?: ReversibleFileEdit[];
  /** Original MJAPI/MJExplorer dependency entries, captured before first link for verbatim restore on unlink. */
  capturedHostDeps?: ReversibleFileEdit[];
  createdAt: string;
}

interface OpenAppsFile {
  version: 1;
  apps: AppDevState[];
}

/**
 * Atomic, file-backed store for open-app dev-link state at `~/.mjdev/openapps.json`,
 * shared by the GUI and `mjdev` CLI (peers via the file, like {@link ProcessStore}).
 * Keyed by (slug, appName). A corrupt file self-heals to empty on read.
 */
export class AppDevStateStore {
  constructor(private readonly paths: ResolvedPaths) {}

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.paths.configDir, { recursive: true });
  }

  private async atomicWrite(file: OpenAppsFile): Promise<void> {
    await this.ensureDir();
    const target = this.paths.openAppsFile;
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2));
    await fs.rename(tmp, target);
  }

  /** Read the full file, degrading a missing/corrupt file to an empty set. */
  private async read(): Promise<OpenAppsFile> {
    try {
      const raw = await fs.readFile(this.paths.openAppsFile, 'utf8');
      const parsed = JSON.parse(raw) as OpenAppsFile;
      return { version: 1, apps: Array.isArray(parsed.apps) ? parsed.apps : [] };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, apps: [] };
      // Self-heal a corrupt file rather than wedging both peers.
      return { version: 1, apps: [] };
    }
  }

  /** All linked apps, optionally filtered to one instance. */
  async list(slug?: string): Promise<AppDevState[]> {
    const apps = (await this.read()).apps;
    return slug ? apps.filter(a => a.slug === slug) : apps;
  }

  async get(slug: string, appName: string): Promise<AppDevState | undefined> {
    return (await this.read()).apps.find(a => a.slug === slug && a.appName === appName);
  }

  /** Insert or update one app's state (matched by slug+appName). */
  async upsert(state: AppDevState): Promise<AppDevState> {
    const file = await this.read();
    const idx = file.apps.findIndex(a => a.slug === state.slug && a.appName === state.appName);
    if (idx >= 0) file.apps[idx] = state;
    else file.apps.push(state);
    await this.atomicWrite(file);
    return state;
  }

  /** Remove one app's state. No-op if absent. */
  async remove(slug: string, appName: string): Promise<void> {
    const file = await this.read();
    const next = file.apps.filter(a => !(a.slug === slug && a.appName === appName));
    if (next.length !== file.apps.length) await this.atomicWrite({ version: 1, apps: next });
  }

  /** Drop all state for an instance (called when the instance is deleted). */
  async removeForInstance(slug: string): Promise<void> {
    const file = await this.read();
    const next = file.apps.filter(a => a.slug !== slug);
    if (next.length !== file.apps.length) await this.atomicWrite({ version: 1, apps: next });
  }
}
