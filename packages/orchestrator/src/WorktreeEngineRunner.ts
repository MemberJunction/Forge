import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run } from './exec.js';
import { emit, type EventSink, noopSink } from './util.js';
import { ENGINE_ENTRY_SOURCE, ENGINE_EVENT_SENTINEL } from './engineEntrySource.js';

/** Connection details for booting the worktree provider against the instance DB. */
export interface EngineDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
}

/**
 * A unit of work for the worktree engine. `steps` are executed in order by the
 * in-worktree entrypoint, each delegating to an exported `@memberjunction/open-app-engine`
 * handler (so the ordering is reproduced but every step's behavior is the engine's own).
 */
export interface EngineJobSpec {
  steps: string[];
  /** The dev-linked app's workspace-member path (app worktree root). */
  memberPath?: string;
  /** Absolute path to the app's `mj-app.json` (loaded once, shared by steps). */
  manifestPath?: string;
  /** Explicit schema name for steps that don't load the manifest (e.g. schemaInfo). */
  schemaName?: string;
  /** Monorepo root the engine mutates (package.json/mj.config.cjs/angular.json). Defaults to the worktree. */
  repoRoot?: string;
  /** Server workspace path relative to repoRoot (default `packages/MJAPI`). */
  serverPackagePath?: string;
  /** Client workspace path relative to repoRoot (default `packages/MJExplorer`). */
  clientPackagePath?: string;
  /** Client bootstrap file subpath (engine default used when omitted). */
  clientBootstrapSubpath?: string;
  /** Other installed apps' manifests, so removal keeps shared prebundle excludes. */
  otherManifests?: unknown[];
  dbConfig: EngineDbConfig;
  mjCoreSchema?: string;
  allowDoubleUnderscore?: boolean;
  /** When set, a failed `checkVersion` step warns instead of throwing (off-tag dev). */
  ignoreVersionRange?: boolean;
  /** GitHub URL for the `install` step (drives the engine's exported `InstallApp`). */
  source?: string;
  /** Optional version/tag for the `install` step (default: the repo's default branch). */
  version?: string;
  /** GitHub token for `install` (defaults to `GITHUB_TOKEN`; unauthenticated for public repos). */
  githubToken?: string;
  /** App manifest name for the `removeApp` step (drives the engine's exported `RemoveApp`). */
  appName?: string;
  /** `removeApp`: preserve the app schema + data (don't DROP SCHEMA). */
  keepData?: boolean;
  /** `removeApp`: remove even if other installed apps depend on it. */
  force?: boolean;
}

export interface EngineRunResult {
  ok: boolean;
  /** Per-step return values keyed by step name (present on success). */
  results?: Record<string, unknown>;
  /** MJ version the worktree booted with (from its own `@memberjunction/core`). */
  mjVersion?: string;
  error?: string;
  /** Raw combined stdout/stderr — handy for diagnosing a boot failure. */
  rawOutput: string;
}

/** Scratch dir inside the worktree for the generated entrypoint + job specs. */
const SCRATCH_DIR = '.mjdev';
/** Exclude pattern that keeps the scratch dir out of the worktree's git status. */
export const ENGINE_SCRATCH_EXCLUDE = `${SCRATCH_DIR}/`;

interface EngineEvent {
  kind: 'progress' | 'success' | 'result' | 'error';
  phase: string;
  message: string;
  data: { results?: Record<string, unknown>; mjVersion?: string } | null;
}

/**
 * Drives the {@link ENGINE_ENTRY_SOURCE} entrypoint inside a specific instance's
 * MJ worktree. Writes the generated `.mjs` + a JSON job spec under `<worktree>/.mjdev/`,
 * spawns `node <entry> <spec>` with the instance's Node on PATH, and parses the
 * sentinel-prefixed NDJSON it streams — forwarding progress to the {@link EventSink}
 * and returning the captured final result.
 */
export class WorktreeEngineRunner {
  /**
   * @param worktreePath the instance MJ worktree to run the engine inside
   * @param entrySource  the entrypoint source to write+spawn; defaults to the real
   *   {@link ENGINE_ENTRY_SOURCE}. Injectable so tests can drive the spawn/parse
   *   protocol with a DB-free fake without standing up SQL Server.
   */
  constructor(
    private readonly worktreePath: string,
    private readonly entrySource: string = ENGINE_ENTRY_SOURCE
  ) {}

  /** Absolute path to the generated entrypoint (written on each run; idempotent). */
  get entryPath(): string {
    return path.join(this.worktreePath, SCRATCH_DIR, 'engine-run.mjs');
  }

  async run(
    slug: string,
    spec: EngineJobSpec,
    env: NodeJS.ProcessEnv = process.env,
    sink: EventSink = noopSink
  ): Promise<EngineRunResult> {
    // Preflight (real entry only): the entry imports the worktree's BUILT
    // @memberjunction packages (dist/). If the instance hasn't been set up (deps +
    // build), bail with a clear, actionable message instead of a cryptic "Cannot find
    // package" from the spawned entry. Skipped when a test injects a fake entrySource
    // (which doesn't import those packages).
    if (this.entrySource === ENGINE_ENTRY_SOURCE) {
      const builtProbe = path.join(
        this.worktreePath,
        'node_modules/@memberjunction/sqlserver-dataprovider/dist/index.js'
      );
      try {
        await fs.access(builtProbe);
      } catch {
        return {
          ok: false,
          rawOutput: '',
          error:
            "Instance worktree isn't built — @memberjunction/sqlserver-dataprovider/dist " +
            'is missing. Run `mjdev setup <slug> all` (or at least deps + build) before ' +
            'linking, installing, or removing open apps.',
        };
      }
    }
    const scratch = path.join(this.worktreePath, SCRATCH_DIR);
    await fs.mkdir(scratch, { recursive: true });
    await fs.writeFile(this.entryPath, this.entrySource);
    // repoRoot defaults to the worktree (where the engine mutates config/package files).
    const fullSpec: EngineJobSpec = { repoRoot: this.worktreePath, ...spec };
    const specPath = path.join(scratch, `engine-job-${Date.now()}.json`);
    await fs.writeFile(specPath, JSON.stringify(fullSpec, null, 2));

    let captured: EngineRunResult = {
      ok: false,
      rawOutput: '',
      error: 'engine produced no result',
    };
    let buffer = '';
    const consumeLine = (line: string): void => {
      if (!line) return;
      if (line.startsWith(ENGINE_EVENT_SENTINEL)) {
        this.handleEvent(slug, line.slice(ENGINE_EVENT_SENTINEL.length), sink, ev => {
          captured = ev;
        });
      } else {
        // Provider boot is verbose; forward as low-priority info for live debugging.
        emit(sink, slug, 'app-engine', 'info', line.trimEnd());
      }
    };

    // Load the instance's own `.env` into the engine process (when present) so it
    // boots with the same secrets the running MJAPI gets via dotenv — notably
    // MJ_BASE_ENCRYPTION_KEY (encrypted-field paths). The engine still uses the
    // EXPLICIT spec.dbConfig for the provider; this only supplies env-driven
    // secrets. Gated on the file existing so fake-entry tests (no .env) are unaffected.
    const envFile = path.join(this.worktreePath, '.env');
    let nodeArgs = [this.entryPath, specPath];
    let spawnEnv: NodeJS.ProcessEnv = env;
    try {
      await fs.access(envFile);
      nodeArgs = ['-r', 'dotenv/config', ...nodeArgs];
      spawnEnv = { ...env, DOTENV_CONFIG_PATH: envFile };
    } catch {
      // No .env (e.g. unit tests) — spawn without dotenv preload.
    }

    const result = await run('node', nodeArgs, {
      cwd: this.worktreePath,
      env: spawnEnv,
      onOutput: chunk => {
        buffer += chunk;
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          consumeLine(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
        }
      },
    });
    if (buffer) consumeLine(buffer);

    const rawOutput = (result.stdout + result.stderr).trim();
    if (result.code !== 0 && captured.ok) {
      // Non-zero exit but we parsed a success result — trust the exit code.
      captured = { ok: false, rawOutput, error: captured.error ?? `engine exited ${result.code}` };
    }
    return { ...captured, rawOutput };
  }

  private handleEvent(
    slug: string,
    json: string,
    sink: EventSink,
    onResult: (r: EngineRunResult) => void
  ): void {
    let ev: EngineEvent;
    try {
      ev = JSON.parse(json) as EngineEvent;
    } catch {
      return;
    }
    if (ev.kind === 'result') {
      emit(sink, slug, 'app-engine', 'success', ev.message);
      onResult({
        ok: true,
        results: ev.data?.results,
        mjVersion: ev.data?.mjVersion,
        rawOutput: '',
      });
      return;
    }
    if (ev.kind === 'error') {
      emit(sink, slug, 'app-engine', 'error', `[${ev.phase}] ${ev.message}`);
      onResult({ ok: false, error: ev.message, rawOutput: '' });
      return;
    }
    emit(
      sink,
      slug,
      'app-engine',
      ev.kind === 'success' ? 'success' : 'progress',
      `[${ev.phase}] ${ev.message}`
    );
  }
}
