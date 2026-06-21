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

    const result = await run('node', [this.entryPath, specPath], {
      cwd: this.worktreePath,
      env,
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
