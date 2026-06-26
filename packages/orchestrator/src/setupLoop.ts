import { emit, type EventSink } from './util.js';
import type { ParsedPushResult } from './syncResult.js';

/**
 * The ADR-009 setup convention loop, as pure orchestration over injected steps so
 * it's identical for core MJ and open apps (each supplies its own sync/codegen/
 * diff/build) and is unit-testable with fakes.
 *
 * Flow (after migrate, which the caller runs first):
 *   sync ─ ok ─→ codegen(verify) ─→ diff(tripwire) ─→ build
 *        └ fail → WARN + codegen(repair) → resync ─ ok ─→ diff → build
 *                                                  └ fail → ESCALATE
 * Codegen runs exactly ONCE per call — in the repair branch the repair codegen
 * doubles as the final codegen (its regen is exactly what the tripwire should flag).
 */
export interface SyncLoopSteps {
  /**
   * Run `mj sync push --format=json`; ok=false when errorCount>0 / non-zero exit.
   * `fatal: true` marks a failure a codegen repair CANNOT fix (e.g. the instance's
   * mj is too old for `--format=json`) — the loop then escalates immediately
   * instead of wasting a codegen + resync and emitting a misleading repair notice.
   */
  sync: () => Promise<{ ok: boolean; error?: string; result?: ParsedPushResult; fatal?: boolean }>;
  /** Run codegen with AI off (the loop never spends tokens). */
  codegen: (opts: { ai: boolean }) => Promise<{ ok: boolean; error?: string }>;
  /** git-diff codegen's output dirs → the convention tripwire. */
  diff: () => Promise<{ changed: boolean; files: string[] }>;
  /** Build (cached; cheap when nothing changed). */
  build: () => Promise<{ ok: boolean; error?: string }>;
}

export interface SyncLoopOutcome {
  ok: boolean;
  /** True when the loop stopped and raised a loud escalation (caller persisted it). */
  escalated: boolean;
  /** True when the first sync failed but the one-shot codegen repair recovered it. */
  syncRepaired: boolean;
  /** True when the tripwire fired (generated code drifted). */
  driftWarning: boolean;
  driftFiles: string[];
  error?: string;
}

/**
 * Run the convention loop. `escalate(summary, detail)` is invoked on an
 * unrecoverable sync/codegen failure; the caller is responsible for the loud,
 * persistent surfacing (red CLI + non-dismissing GUI modal + `logs/` file) — this
 * function only decides WHEN to escalate and returns the outcome.
 */
export async function runSyncConventionLoop(
  slug: string,
  op: string,
  steps: SyncLoopSteps,
  sink: EventSink,
  escalate: (summary: string, detail: string) => Promise<void>
): Promise<SyncLoopOutcome> {
  let syncRepaired = false;

  const sync1 = await steps.sync();
  if (!sync1.ok && sync1.fatal) {
    // A codegen repair can't fix this class of failure (e.g. the instance's mj is
    // too old for `--format=json`). Escalate straight away with the real cause —
    // no misleading "attempting repair" notice, no wasted codegen + resync.
    await escalate(
      'Sync failed and a codegen repair cannot fix it',
      `Setup sync failed with a non-recoverable error:\n  • ${sync1.error ?? '(no detail)'}`
    );
    return outcome(false, true, false, { changed: false, files: [] }, sync1.error);
  }
  if (!sync1.ok) {
    emit(
      sink,
      slug,
      op,
      'warn',
      `mj sync push failed — the migrations are out of sync with codegen, so the convention is ` +
        `broken on this branch. Attempting a one-shot codegen repair to register entities the ` +
        `migration didn't… (${sync1.error ?? 'sync error'})`
    );
    const repair = await steps.codegen({ ai: false });
    if (!repair.ok) {
      const detail =
        `Setup sync failed, and the one-shot codegen repair also failed.\n` +
        `  • sync:    ${sync1.error ?? '(no detail)'}\n` +
        `  • codegen: ${repair.error ?? '(no detail)'}`;
      await escalate('Sync failed and the codegen repair also failed', detail);
      return outcome(false, true, false, { changed: false, files: [] }, repair.error);
    }
    const sync2 = await steps.sync();
    if (!sync2.ok) {
      const detail =
        `Setup sync still failed after a one-shot codegen repair. This is not a registration gap ` +
        `codegen can fix — likely a DB-execution failure (e.g. an integration PK divergence / a ` +
        `UQ_* unique-key violation on this branch). The push is transactional, so it rolled back.\n` +
        `  • first sync: ${sync1.error ?? '(no detail)'}\n` +
        `  • resync:     ${sync2.error ?? '(no detail)'}`;
      await escalate('Sync still failing after the codegen repair', detail);
      return outcome(false, true, true, { changed: false, files: [] }, sync2.error);
    }
    syncRepaired = true;
    // Repair codegen already ran → skip a redundant verification codegen.
  } else {
    const cg = await steps.codegen({ ai: false });
    if (!cg.ok) {
      await escalate('Codegen failed during setup', cg.error ?? '(no detail)');
      return outcome(false, true, false, { changed: false, files: [] }, cg.error);
    }
  }

  const drift = await steps.diff();
  if (drift.changed) {
    const shown = drift.files.slice(0, 8).join(', ');
    const more = drift.files.length > 8 ? ` (+${drift.files.length - 8} more)` : '';
    emit(
      sink,
      slug,
      op,
      'warn',
      `Generated code changed after migrate + sync + codegen. This is diff-derived (it may include ` +
        `your own edits to generated files), but it usually means the migration is out of convention ` +
        `on this branch — commit the regenerated code with its migration, or raise it for next. ` +
        `Changed: ${shown}${more}`
    );
  }

  const build = await steps.build();
  if (!build.ok) {
    return {
      ok: false,
      escalated: false,
      syncRepaired,
      driftWarning: drift.changed,
      driftFiles: drift.files,
      error: build.error,
    };
  }

  return {
    ok: true,
    escalated: false,
    syncRepaired,
    driftWarning: drift.changed,
    driftFiles: drift.files,
  };

  function outcome(
    ok: boolean,
    escalated: boolean,
    repaired: boolean,
    driftInfo: { changed: boolean; files: string[] },
    error?: string
  ): SyncLoopOutcome {
    return {
      ok,
      escalated,
      syncRepaired: repaired,
      driftWarning: driftInfo.changed,
      driftFiles: driftInfo.files,
      error,
    };
  }
}
