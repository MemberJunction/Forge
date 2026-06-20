import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Tunable filesystem locations for the orchestrator. Every path is overridable
 * so the engine can be pointed at a scratch directory in tests.
 */
export interface OrchestratorOptions {
  /** Root of the MJ git repository worktrees are created from. */
  mjRepoPath?: string;
  /** Directory under which per-instance worktrees are created. */
  worktreesDir?: string;
  /** Base config/state directory (defaults to `~/.mjdev`). */
  configDir?: string;
}

/** Fully-resolved paths used throughout the engine. */
export interface ResolvedPaths {
  mjRepoPath: string;
  worktreesDir: string;
  configDir: string;
  instancesFile: string;
  instancesDir: string;
  secretsFile: string;
  /** Developer-persona roster (`~/.mjdev/personas.json`). */
  personasFile: string;
  /** Minted per-instance/per-persona API keys (`~/.mjdev/apikeys.json`, 0600). */
  apiKeysFile: string;
}

/** Default MJ repo location; override via options or the `MJDEV_MJ_REPO` env var. */
const DEFAULT_MJ_REPO = '/Users/marcelotorres/projects/MJ/MJ';

export function resolvePaths(options: OrchestratorOptions = {}): ResolvedPaths {
  const home = os.homedir();
  const configDir = options.configDir ?? process.env.MJDEV_CONFIG_DIR ?? path.join(home, '.mjdev');
  const mjRepoPath = options.mjRepoPath ?? process.env.MJDEV_MJ_REPO ?? DEFAULT_MJ_REPO;
  const worktreesDir =
    options.worktreesDir ?? process.env.MJDEV_WORKTREES_DIR ?? path.join(home, 'mj-worktrees');

  return {
    mjRepoPath,
    worktreesDir,
    configDir,
    instancesFile: path.join(configDir, 'instances.json'),
    instancesDir: path.join(configDir, 'instances'),
    secretsFile: path.join(configDir, 'secrets.json'),
    personasFile: path.join(configDir, 'personas.json'),
    apiKeysFile: path.join(configDir, 'apikeys.json'),
  };
}
