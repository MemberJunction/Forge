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
  /**
   * Per-instance developer-persona override (Phase 2). When set, this instance
   * authenticates as the named {@link DevPersona} instead of the globally
   * active persona — letting a developer test a single instance as a different
   * user without affecting the global default or any other instance. When
   * unset, the instance falls back to the active persona in `personas.json`.
   * Changing it re-mints that instance's credentials on next use.
   */
  personaId?: string;
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
  /** Base64-encoded 256-bit key for MJ field-level encryption
   *  (`MJ_BASE_ENCRYPTION_KEY`). Auto-generated per instance. */
  encryptionKey: string;
  /**
   * System API key for the instance (`MJ_API_KEY`). Authenticates as MJ's
   * system Owner user via the `x-mj-api-key` header — the privileged caller the
   * dev tool uses to issue magic-link invites. Auto-generated per instance (Phase 2).
   */
  systemApiKey?: string;
  /**
   * Base64-encoded PEM RSA private key (`MJ_MAGIC_LINK_PRIVATE_KEY`) MJAPI uses
   * to sign magic-link session JWTs. Generated per instance so sessions survive
   * MJAPI restarts (Phase 2).
   */
  magicLinkPrivateKey?: string;
}

/**
 * A named developer identity (Phase 2). The mjdev app manages a small roster of
 * these in `~/.mjdev/personas.json`; one is the globally active persona, and an
 * instance may override it via {@link InstanceRecord.personaId}. Each persona
 * maps to a single MJ User (by `email`) and drives both the browser magic-link
 * session and the minted `mj_sk_*` API key for CLI/agents.
 */
export interface DevPersona {
  id: string;
  /** Display name shown in pickers, e.g. "Admin" or "Viewer". */
  name: string;
  /** Dev email — the unique key for the underlying MJ User, e.g. admin@mjdev.local. */
  email: string;
  firstName?: string;
  lastName?: string;
  /** MJ role names to grant the user (resolved to `__mj.Role` rows by name). */
  roles: string[];
}

/** Roster file persisted at `~/.mjdev/personas.json`. */
export interface PersonaRoster {
  personas: DevPersona[];
  /** Id of the globally active persona, if one has been chosen. */
  activePersonaId?: string;
}

/**
 * A minted, persisted user API key (`mj_sk_*`) for a given instance + persona,
 * stored under `~/.mjdev/secrets.json` so it is reused for the whole session
 * rather than re-minted. Keyed `apiKeys[secretsRef][personaId]`.
 */
export interface MintedApiKey {
  /** The raw `mj_sk_*` key (only the SHA-256 hash lives in the instance DB). */
  rawKey: string;
  /** Id of the `__mj.APIKey` row, for later revocation. */
  apiKeyId: string;
  /** ISO-8601 timestamp the key was minted. */
  mintedAt: string;
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
