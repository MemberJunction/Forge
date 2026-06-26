import { describe, it, expect } from 'vitest';
import { parsePushResult, isPushNoop, isUnsupportedFormatFlag } from '../../dist/index.js';

/** A realistic `mj sync push --format=json` MJCLIResult payload. */
function pushJson(data: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    success: (data.errorCount ?? 0) === 0,
    command: 'sync:push',
    durationSeconds: 12.3,
    data: {
      created: 0,
      updated: 0,
      unchanged: 0,
      deleted: 0,
      skipped: 0,
      deferred: 0,
      errorCount: 0,
      dryRun: false,
      ...data,
    },
    errors: [],
    ...extra,
  });
}

describe('parsePushResult', () => {
  it('parses a clean no-op push', () => {
    const r = parsePushResult(pushJson({ unchanged: 102 }));
    expect(r).not.toBeNull();
    expect(r!.success).toBe(true);
    expect(r!.errorCount).toBe(0);
    expect(r!.unchanged).toBe(102);
    expect(isPushNoop(r!)).toBe(true);
  });

  it('parses a push that made changes (not a no-op)', () => {
    const r = parsePushResult(pushJson({ created: 5, updated: 3, unchanged: 90 }));
    expect(r!.created).toBe(5);
    expect(r!.updated).toBe(3);
    expect(isPushNoop(r!)).toBe(false);
  });

  it('flags a failed push via errorCount and carries error messages', () => {
    const r = parsePushResult(
      pushJson(
        { created: 100, errorCount: 2 },
        {
          success: false,
          errors: [{ message: 'UQ_IntegrationObject_Name violation' }, 'second error'],
        }
      )
    );
    expect(r!.success).toBe(false); // errorCount > 0 ⇒ not success even if `success` were true
    expect(r!.errorCount).toBe(2);
    expect(r!.errors).toEqual(['UQ_IntegrationObject_Name violation', 'second error']);
  });

  it('treats errorCount>0 as not-success even when the object claims success:true', () => {
    const r = parsePushResult(pushJson({ errorCount: 1 }, { success: true }));
    expect(r!.success).toBe(false);
  });

  it('extracts the JSON even when log lines surround it', () => {
    const noisy = [
      '[info] connecting to db…',
      'Validating metadata',
      pushJson({ created: 1 }),
      'Done.',
    ].join('\n');
    const r = parsePushResult(noisy);
    expect(r!.created).toBe(1);
  });

  it('picks the LAST sync-push object when several are present', () => {
    const out = [pushJson({ created: 99 }), pushJson({ created: 7, unchanged: 5 })].join('\n');
    const r = parsePushResult(out);
    expect(r!.created).toBe(7);
  });

  it('ignores braces inside string values', () => {
    const r = parsePushResult(pushJson({ created: 2 }, { errors: ['oops {not json} here'] }));
    expect(r!.created).toBe(2);
  });

  it('returns null when there is no parseable result', () => {
    expect(parsePushResult('just some logs, no json')).toBeNull();
    expect(parsePushResult('{ broken json')).toBeNull();
  });

  it('recognizes a data-shaped object even without command field', () => {
    const r = parsePushResult(
      JSON.stringify({ data: { created: 0, updated: 0, deleted: 0, errorCount: 0 } })
    );
    expect(r).not.toBeNull();
    expect(isPushNoop(r!)).toBe(true);
  });

  it('ignores the streamed {event:start, command:sync:push} marker and reads the real result (regression: stdout+stderr concat)', () => {
    // Live shape: the MJCLIResult prints to stdout; progress events (incl. a
    // `command:sync:push` START marker with NO data) stream to stderr. Callers
    // concatenate stdout+'\n'+stderr, so the start marker sorts AFTER the result.
    // A bare command match would wrongly pick it and report a bogus all-zero fail.
    const stdout = pushJson({ updated: 4, unchanged: 13107 });
    const stderr = [
      '{"event":"start","command":"sync:push","runtime":{"class":"variable"}}',
      '{"event":"step","label":"Loading configuration"}',
      '{"event":"step-done","label":"metadata/entities — 76 records, no changes"}',
    ].join('\n');
    const r = parsePushResult(stdout + '\n' + stderr);
    expect(r).not.toBeNull();
    expect(r!.success).toBe(true); // NOT the all-zero start marker
    expect(r!.updated).toBe(4);
    expect(r!.unchanged).toBe(13107);
  });

  it('a lone {event:start, command:sync:push} marker (no data) is NOT treated as a result', () => {
    expect(parsePushResult('{"event":"start","command":"sync:push"}')).toBeNull();
  });
});

describe('isUnsupportedFormatFlag (old-mj guard)', () => {
  it('detects the oclif "Nonexistent flag: --format=json" rejection (mj ≤ 5.40.x)', () => {
    // Real output captured live from mj 5.40.2 in openapp-dev.
    const out = [
      '~ MemberJunction ~',
      '@memberjunction/cli/5.40.2 darwin-arm64 node-v24.16.0',
      ' ›   Error: Nonexistent flag: --format=json',
      ' ›   See more help with --help',
    ].join('\n');
    expect(isUnsupportedFormatFlag(out)).toBe(true);
  });

  it('also matches the bare "--format" phrasing', () => {
    expect(isUnsupportedFormatFlag('Error: Nonexistent flag: --format')).toBe(true);
  });

  it('does not false-positive on a normal failed push', () => {
    expect(isUnsupportedFormatFlag(pushJson({ errorCount: 1 }, { success: false }))).toBe(false);
    expect(isUnsupportedFormatFlag('some unrelated error about a missing record')).toBe(false);
  });
});
