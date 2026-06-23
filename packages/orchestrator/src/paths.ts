import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Tunable filesystem locations for the orchestrator. Every path is overridable
 * so the engine can be pointed at a scratch directory in tests.
 */
export interface OrchestratorOptions {
  /**
   * Repo that worktrees are created from. Defaults to the app-managed central
   * clone (`workspaceRoot/repos/mj`). Set this (or `MJDEV_MJ_REPO`) to worktree
   * directly from an existing checkout and skip the managed clone entirely.
   */
  mjRepoPath?: string;
  /** Local MJ checkout the managed central clone is *seeded* from. */
  mjSourcePath?: string;
  /** Visible, shareable workspace root (defaults to `~/MJDev`). */
  workspaceRoot?: string;
  /** @deprecated Legacy flat worktrees dir; instances now nest under the workspace. */
  worktreesDir?: string;
  /** Hidden secrets/state directory (defaults to `~/.mjdev`). */
  configDir?: string;
  /**
   * Prefix for this workspace's Docker container/volume names (defaults to
   * `mjdev`). An isolated dev workspace sets `mjdev-dev` so its containers can
   * never collide with — or be mistaken for — the production `mjdev-<slug>` ones.
   */
  containerPrefix?: string;
}

/** Fully-resolved paths used throughout the engine. */
export interface ResolvedPaths {
  /** Visible, shareable workspace root (`~/MJDev`). */
  workspaceRoot: string;
  /** Central clones live here (`~/MJDev/repos`). */
  reposDir: string;
  /** App-managed MJ clone that worktrees are created from (`~/MJDev/repos/mj`). */
  mjClonePath: string;
  /** Canonical editable clones of open-app source repos (`~/MJDev/repos/apps`). */
  appsReposDir: string;
  /** Local MJ checkout the managed clone is seeded from. */
  mjSourcePath: string;
  /** Repo worktrees are actually created from (the managed clone unless overridden). */
  mjRepoPath: string;
  /** Per-instance folders (`~/MJDev/instances/<slug>/`). */
  instancesRootDir: string;
  /** @deprecated Retained for back-compat; equals {@link instancesRootDir} by default. */
  worktreesDir: string;
  /** Hidden secrets/state root (`~/.mjdev`). */
  configDir: string;
  /** Docker container/volume name prefix for this workspace (`mjdev` or `mjdev-dev`). */
  containerPrefix: string;
  instancesFile: string;
  instancesDir: string;
  secretsFile: string;
  /** Developer-persona roster (`~/.mjdev/personas.json`). */
  personasFile: string;
  /** Minted per-instance/per-persona API keys (`~/.mjdev/apikeys.json`, 0600). */
  apiKeysFile: string;
  /** Shared running-process registry (`~/.mjdev/processes.json`) — CLI + GUI peers. */
  processesFile: string;
  /** Per-instance open-app dev-link state (`~/.mjdev/openapps.json`) — CLI + GUI peers. */
  openAppsFile: string;
  /** Per-process detached-stdout log files (`~/.mjdev/proc-logs/`). */
  procLogsDir: string;
}

/**
 * Default local MJ checkout the managed clone is seeded from; override via
 * `options.mjSourcePath` or the `MJDEV_MJ_SOURCE` env var.
 */
const DEFAULT_MJ_SOURCE = '/Users/marcelotorres/projects/MJ/MJ';

export function resolvePaths(options: OrchestratorOptions = {}): ResolvedPaths {
  const home = os.homedir();
  // Hidden secrets/state root — never moves into the shareable workspace.
  const configDir = options.configDir ?? process.env.MJDEV_CONFIG_DIR ?? path.join(home, '.mjdev');
  // Visible, shareable workspace root.
  const workspaceRoot =
    options.workspaceRoot ?? process.env.MJDEV_WORKSPACE_DIR ?? path.join(home, 'MJDev');

  const reposDir = path.join(workspaceRoot, 'repos');
  const mjClonePath = path.join(reposDir, 'mj');
  const appsReposDir = path.join(reposDir, 'apps');
  const instancesRootDir = path.join(workspaceRoot, 'instances');

  const mjSourcePath = options.mjSourcePath ?? process.env.MJDEV_MJ_SOURCE ?? DEFAULT_MJ_SOURCE;
  // Worktrees come from the app-managed clone unless explicitly pointed elsewhere
  // (escape hatch: `MJDEV_MJ_REPO` / `options.mjRepoPath` skips the managed clone).
  const mjRepoPath = options.mjRepoPath ?? process.env.MJDEV_MJ_REPO ?? mjClonePath;
  const worktreesDir = options.worktreesDir ?? process.env.MJDEV_WORKTREES_DIR ?? instancesRootDir;
  // Container/volume name prefix — scopes this workspace's Docker objects so an
  // isolated dev workspace (`mjdev-dev`) never collides with production (`mjdev`).
  const containerPrefix = options.containerPrefix ?? process.env.MJDEV_CONTAINER_PREFIX ?? 'mjdev';

  return {
    workspaceRoot,
    reposDir,
    mjClonePath,
    appsReposDir,
    mjSourcePath,
    mjRepoPath,
    instancesRootDir,
    worktreesDir,
    configDir,
    containerPrefix,
    instancesFile: path.join(configDir, 'instances.json'),
    instancesDir: path.join(configDir, 'instances'),
    secretsFile: path.join(configDir, 'secrets.json'),
    personasFile: path.join(configDir, 'personas.json'),
    apiKeysFile: path.join(configDir, 'apikeys.json'),
    processesFile: path.join(configDir, 'processes.json'),
    openAppsFile: path.join(configDir, 'openapps.json'),
    procLogsDir: path.join(configDir, 'proc-logs'),
  };
}
