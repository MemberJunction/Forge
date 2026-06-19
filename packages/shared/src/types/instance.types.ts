/**
 * MJ Dev Manager — instance orchestration type definitions.
 *
 * These are pure data types shared across the orchestrator engine, the main
 * process IPC layer, the preload bridge, the renderer, and the CLI. No Node or
 * Electron imports may appear here.
 */

/** Lifecycle status of a managed MJ dev instance. */
export type InstanceStatus = 'provisioning' | 'stopped' | 'running' | 'error';

/** Discrete, on-demand setup steps run after provisioning. */
export type SetupStep = 'deps' | 'migrate' | 'codegen' | 'build';

/** The three port roles every instance allocates. */
export interface InstancePorts {
  sql: number;
  api: number;
  explorer: number;
}

/** Which post-provision setup steps have completed for an instance. */
export interface InstanceSetupState {
  configWritten: boolean;
  depsInstalled: boolean;
  migrated: boolean;
  codegen: boolean;
  built: boolean;
}

/** Docker container coordinates for an instance's SQL Server. */
export interface InstanceContainer {
  /** Container name, e.g. `mjdev-<slug>`. */
  name: string;
  /** Docker container id, populated once created. */
  id?: string;
  /** Named data volume, e.g. `mjdev-<slug>-data`. */
  volume: string;
}

/**
 * The persisted record for a single managed instance. Stored in
 * `~/.mjdev/instances.json` and read by both the GUI and the CLI.
 */
export interface InstanceRecord {
  id: string;
  slug: string;
  name: string;
  branch: string;
  /** Absolute path to the git worktree, e.g. `~/mj-worktrees/<slug>`. */
  worktreePath: string;
  container: InstanceContainer;
  ports: InstancePorts;
  dbName: string;
  /** Key into `~/.mjdev/secrets.json` for this instance's credentials. */
  secretsRef: string;
  status: InstanceStatus;
  setup: InstanceSetupState;
  /** Node version spec to run setup/build/serve under (`'auto'` = highest installed). */
  node?: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * Editable per-instance configuration, authored as YAML at
 * `~/.mjdev/instances/<slug>.yaml`. All fields except `name` are optional;
 * omitted ports are auto-allocated.
 */
export interface InstanceConfig {
  name: string;
  /** Existing branch to check out, or a new branch to create off `baseRef`. */
  branch?: string;
  /** Branch point used when `branch` does not yet exist. */
  baseRef?: string;
  ports?: Partial<InstancePorts>;
  database?: {
    name?: string;
    /** `'auto'` generates a strong password stored in secrets.json. */
    saPassword?: string;
  };
  auth?: {
    provider?: 'none' | 'entra' | 'auth0';
  };
  /**
   * Node version to run this instance's setup/build/serve under (independent of
   * the Forge app's own Node). A major ("24"), full ("24.16.0"), or `'auto'`
   * (default — highest installed nvm version). Lets an MJ checkout that needs
   * Node ≥22 build even when Forge runs on Node 20.
   */
  node?: string;
}

/** Secrets persisted out-of-band (chmod 0600), keyed by `secretsRef`. */
export interface InstanceSecrets {
  saPassword: string;
  dbUsername: string;
  dbPassword: string;
  codegenUsername: string;
  codegenPassword: string;
}

/** Severity/kind of an orchestration progress event. */
export type InstanceEventLevel = 'info' | 'progress' | 'success' | 'warn' | 'error';

/**
 * A streamed progress/log event emitted during long-running operations
 * (create, setup steps, process output). Forwarded to the GUI over the
 * EVENTS channel and to the CLI as `--json` lines.
 */
export interface InstanceEvent {
  /** Slug of the instance this event concerns. */
  slug: string;
  level: InstanceEventLevel;
  /** Logical operation, e.g. `create`, `setup:migrate`, `proc:api`. */
  op: string;
  message: string;
  /** ISO-8601 timestamp. */
  at: string;
}

/** A long-running service process launched for an instance. */
export interface ManagedProcess {
  /** Stable id for this process within its instance. */
  id: string;
  slug: string;
  /** Human label, e.g. `MJAPI`, `MJExplorer`, or a package script name. */
  label: string;
  /** The npm/script identifier that was launched. */
  script: string;
  /** Port the service listens on, when known. */
  port?: number;
  pid?: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
  startedAt: string;
}

/** Result envelope returned by orchestrator façade operations. */
export interface InstanceOperationResult {
  success: boolean;
  slug?: string;
  record?: InstanceRecord;
  error?: string;
}
