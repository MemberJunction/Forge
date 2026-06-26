import * as path from 'node:path';
import type { SetupStep } from '@mj-forge/shared';
import { run } from './exec.js';
import { emit, type EventSink, noopSink } from './util.js';
import {
  parsePushResult,
  isUnsupportedFormatFlag,
  OLD_MJ_SYNC_ERROR,
  type ParsedPushResult,
} from './syncResult.js';

/** The npm script each setup step shells out to, run in the worktree. */
const STEP_COMMANDS: Record<SetupStep, { command?: string; args: string[]; label: string }> = {
  deps: { args: ['ci'], label: 'Install dependencies' },
  migrate: { args: ['run', 'mj:migrate'], label: 'Run database migrations' },
  codegen: { args: ['run', 'mj:codegen'], label: 'Run CodeGen' },
  build: { args: ['run', 'build'], label: 'Build workspace' },
};

/**
 * True when `npm ci` failed specifically because the lockfile is absent or out
 * of sync with package.json — the case where falling back to `npm install` is
 * safe and correct (a disposable dev worktree may sit on a commit whose lock
 * drifted). Matches npm's several phrasings across versions.
 */
function isLockSyncFailure(output: string): boolean {
  return (
    /can only install with an existing package-lock/i.test(output) ||
    /can only install packages when your package\.json and package-lock\.json/i.test(output) ||
    /Missing: .+ from lock file/i.test(output) ||
    /npm error code EUSAGE/i.test(output) ||
    /\bin sync\b/i.test(output)
  );
}

/**
 * Order enforced by `runFullSetup`, reflecting real dependencies in a *source*
 * worktree: the `mj` CLI is TypeScript that loads its oclif commands from
 * `dist/`, so the workspace must be **built before** migrate/codegen can run.
 * (MJ's own installer runs migrate before build only against a pre-built
 * distribution — not applicable here.) Generated entity code is committed, so
 * the initial build succeeds without codegen.
 *
 * **`codegen` is deliberately NOT here.** A fresh instance's committed generated
 * code already matches its committed migrations, so provisioning never needs to
 * regenerate. Re-running codegen against a DB that's missing un-migrated metadata
 * would CLOBBER committed generated files (see ADR-007). Codegen is an explicit
 * on-demand step (`runStep('codegen', …)`), run only when a developer changes
 * this instance's schema/metadata. Metadata authoring (`mj sync push`) is likewise
 * a deliberate manual operation in the worktree, never part of setup.
 */
export const FULL_SETUP_ORDER: SetupStep[] = ['deps', 'build', 'migrate'];

export interface SetupStepResult {
  step: SetupStep;
  success: boolean;
  error?: string;
}

/**
 * Runs the heavy, on-demand setup steps by shelling the `mj`/npm scripts inside
 * an instance's worktree. Each step is idempotent and re-runnable. The
 * orchestrator persists the resulting `setup.*` flags.
 */
export class SetupRunner {
  /** Run a single setup step in the worktree. */
  async runStep(
    step: SetupStep,
    worktreePath: string,
    slug: string,
    sink: EventSink = noopSink,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<SetupStepResult> {
    const spec = STEP_COMMANDS[step];
    const op = `setup:${step}`;
    emit(sink, slug, op, 'progress', `${spec.label}…`);

    let result = await run(spec.command ?? 'npm', spec.args, {
      cwd: worktreePath,
      env,
      onOutput: s => emit(sink, slug, op, 'info', s.trimEnd()),
    });

    // `npm ci` is strict: it aborts on a missing lockfile OR any drift between
    // package.json and the committed lock (common across MJ commits). In a
    // disposable dev worktree the right move — what a human does — is to fall
    // back to `npm install`, which reconciles the lock and installs.
    if (step === 'deps' && result.code !== 0 && isLockSyncFailure(result.stderr + result.stdout)) {
      emit(
        sink,
        slug,
        op,
        'warn',
        '`npm ci` rejected the lockfile (out of sync); falling back to `npm install`'
      );
      result = await run('npm', ['install'], {
        cwd: worktreePath,
        env,
        onOutput: s => emit(sink, slug, op, 'info', s.trimEnd()),
      });
    }

    if (result.code !== 0) {
      const error = `${spec.label} failed (exit ${result.code})`;
      emit(sink, slug, op, 'error', error);
      return { step, success: false, error };
    }
    emit(sink, slug, op, 'success', `${spec.label} complete`);
    return { step, success: true };
  }

  /**
   * Run core MJ metadata sync (`mj sync push --dir=metadata --format=json`) in the
   * worktree root. `--format=json` is load-bearing (ADR-009): it makes the push
   * NON-INTERACTIVE (never hangs on the validation prompt) and emits a parseable
   * `PushResult` we branch on. Returns the parsed result + an `ok` derived from it
   * (errorCount===0) falling back to the exit code. Used by the setup convention loop.
   */
  async runCoreSync(
    worktreePath: string,
    slug: string,
    sink: EventSink = noopSink,
    env: NodeJS.ProcessEnv = process.env
  ): Promise<{ ok: boolean; error?: string; result?: ParsedPushResult; fatal?: boolean }> {
    const op = 'setup:sync';
    const mjBin = path.join(worktreePath, 'packages', 'MJCLI', 'bin', 'run.js');
    const envFile = path.join(worktreePath, '.env');
    emit(sink, slug, op, 'progress', 'Core metadata sync (mj sync push)…');
    const result = await run(
      'node',
      ['-r', 'dotenv/config', mjBin, 'sync', 'push', '--dir=metadata', '--format=json'],
      {
        cwd: worktreePath,
        env: { ...env, DOTENV_CONFIG_PATH: envFile },
        onOutput: s => {
          const line = s.trimEnd();
          if (line && !line.startsWith('{') && !line.startsWith('"'))
            emit(sink, slug, op, 'info', line);
        },
      }
    );
    // The `--format=json` MJCLIResult prints to STDOUT; progress events (incl. a
    // `command:sync:push` start marker) stream to STDERR. Parse stdout first so the
    // real result wins, falling back to the combined stream only if stdout had none.
    const combined = result.stdout + '\n' + result.stderr;
    const parsed = parsePushResult(result.stdout) ?? parsePushResult(combined) ?? undefined;
    const ok = parsed ? parsed.success : result.code === 0;
    if (!ok) {
      // Old-mj guard: a missing `--format` flag is a version gap, not a record error.
      const oldMj = !parsed && isUnsupportedFormatFlag(combined);
      const reason = oldMj
        ? OLD_MJ_SYNC_ERROR
        : parsed
          ? `${parsed.errorCount} record error(s)${parsed.errors[0] ? `: ${parsed.errors[0]}` : ''}`
          : `exited ${result.code}: ${(result.stderr || result.stdout).trim().split('\n').slice(-4).join('\n')}`;
      emit(sink, slug, op, 'warn', `Core metadata sync failed — ${reason}`);
      return {
        ok: false,
        error: `Core metadata sync failed — ${reason}`,
        result: parsed,
        fatal: oldMj,
      };
    }
    const summary = parsed
      ? ` (created ${parsed.created}, updated ${parsed.updated}, deleted ${parsed.deleted}, unchanged ${parsed.unchanged})`
      : '';
    emit(sink, slug, op, 'success', `Core metadata sync complete${summary}`);
    return { ok: true, result: parsed };
  }

  /**
   * Run all setup steps in order, stopping at the first failure. Returns the
   * per-step results so the caller can persist partial progress and resume.
   */
  async runFullSetup(
    worktreePath: string,
    slug: string,
    sink: EventSink = noopSink,
    onStepComplete?: (step: SetupStep) => Promise<void>,
    skip: SetupStep[] = [],
    env: NodeJS.ProcessEnv = process.env
  ): Promise<SetupStepResult[]> {
    const results: SetupStepResult[] = [];
    const done = new Set(skip);
    emit(sink, slug, 'setup:all', 'progress', 'Running full setup (deps → build → migrate)…');
    for (const step of FULL_SETUP_ORDER) {
      if (done.has(step)) {
        emit(sink, slug, `setup:${step}`, 'info', `Skipping ${step} (already complete)`);
        continue;
      }
      const result = await this.runStep(step, worktreePath, slug, sink, env);
      results.push(result);
      if (!result.success) {
        emit(sink, slug, 'setup:all', 'error', `Stopped at "${step}". Fix the issue and re-run.`);
        return results;
      }
      await onStepComplete?.(step);
    }
    emit(sink, slug, 'setup:all', 'success', 'Full setup complete');
    return results;
  }
}

/** Map a completed setup step to the InstanceSetupState flag it sets. */
export function setupFlagForStep(
  step: SetupStep
): keyof import('@mj-forge/shared').InstanceSetupState {
  switch (step) {
    case 'deps':
      return 'depsInstalled';
    case 'migrate':
      return 'migrated';
    case 'codegen':
      return 'codegen';
    case 'build':
      return 'built';
  }
}
