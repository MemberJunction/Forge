/**
 * Parsing for the machine-readable result of `mj sync push --format=json`.
 *
 * Under `--format=json` the MJCLI prints an `MJCLIResult` object whose `data`
 * carries MetadataSync's `PushResult` counts (created/updated/unchanged/deleted/
 * skipped/deferred/errorCount). The setup loop (ADR-009) branches on `errorCount`,
 * so we need those numbers — not the human text. CLI output can interleave a few
 * stray log lines around the JSON, so we extract the LAST balanced top-level JSON
 * object that looks like a sync-push result and read its counts. Pure + testable.
 */

export interface ParsedPushResult {
  /** The CLI's own success verdict (errorCount === 0 and no thrown errors). */
  success: boolean;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  skipped: number;
  deferred: number;
  /** Number of record-level errors — the value the setup loop branches on. */
  errorCount: number;
  dryRun: boolean;
  /** Top-level error messages, if any (for surfacing/escalation). */
  errors: string[];
}

/** True when the push changed nothing (a clean no-op reconcile). */
export function isPushNoop(r: ParsedPushResult): boolean {
  return r.created === 0 && r.updated === 0 && r.deleted === 0;
}

/**
 * True when `mj sync push --format=json` was REJECTED because the instance's mj
 * CLI predates the `--format` flag (added to the sync push/pull commands around
 * MJ v5.42 / `next`). Legacy instances (≤ v5.40.x) hit this. The convention loop
 * can't self-heal it — a codegen repair won't add a CLI flag — so callers should
 * surface the real cause (recreate the instance off a `next`-based ref) instead of
 * the loop's generic "DB-execution failure" guess. Matches oclif's phrasing.
 */
export function isUnsupportedFormatFlag(output: string): boolean {
  return /Nonexistent flag:\s*--format/i.test(output);
}

/** The accurate, actionable error for the old-mj case {@link isUnsupportedFormatFlag} detects. */
export const OLD_MJ_SYNC_ERROR =
  "this instance's mj CLI is too old for the sync convention — it rejects " +
  '`--format=json` (added to `mj sync push` around v5.42 / `next`). A codegen repair ' +
  'cannot fix a missing CLI flag; recreate the instance off a `next`-based base ref.';

/**
 * Extract the parsed push result from mixed CLI output (stdout, optionally with
 * stderr appended). Returns null when no parseable sync-push result is present —
 * callers then fall back to the process exit code.
 */
export function parsePushResult(output: string): ParsedPushResult | null {
  const objects = extractTopLevelJsonObjects(output);
  // Prefer the last sync-push RESULT (the final summary the CLI prints).
  //
  // Match strictly on the presence of a `data` object carrying the PushResult
  // count fields. We must NOT match on `command === 'sync:push'` alone: under
  // `--format=json` the CLI also streams a `{"event":"start","command":"sync:push"}`
  // marker (to stderr) that has no `data`. When callers parse stdout+stderr together
  // that start marker sorts AFTER the real result, so a bare-command match would
  // pick it and report a bogus all-zero failure (the result lives in `data`).
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!obj || typeof obj !== 'object') continue;
    const data = (obj as Record<string, unknown>).data as Record<string, unknown> | undefined;
    const looksLikeResult =
      data != null &&
      typeof data === 'object' &&
      ('created' in data || 'errorCount' in data || 'deleted' in data || 'unchanged' in data);
    if (!looksLikeResult) continue;
    return toParsed(obj as Record<string, unknown>, data);
  }
  return null;
}

function toParsed(obj: Record<string, unknown>, data: Record<string, unknown>): ParsedPushResult {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const rawErrors = obj.errors;
  const errors: string[] = Array.isArray(rawErrors)
    ? rawErrors.map(e =>
        typeof e === 'string' ? e : ((e as { message?: string })?.message ?? JSON.stringify(e))
      )
    : [];
  const errorCount = num(data.errorCount);
  return {
    success: obj.success === true && errorCount === 0,
    created: num(data.created),
    updated: num(data.updated),
    unchanged: num(data.unchanged),
    deleted: num(data.deleted),
    skipped: num(data.skipped),
    deferred: num(data.deferred),
    errorCount,
    dryRun: data.dryRun === true,
    errors,
  };
}

/**
 * Scan `text` for balanced top-level `{…}` JSON objects and return the ones that
 * parse. Respects string literals and escapes so braces inside strings don't
 * throw off depth tracking. Nested objects are returned as part of their parent
 * only (we collect depth-0 spans).
 */
function extractTopLevelJsonObjects(text: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          const span = text.slice(start, i + 1);
          try {
            out.push(JSON.parse(span));
          } catch {
            /* not valid JSON — skip */
          }
          start = -1;
        }
      }
    }
  }
  return out;
}
